/**
 * Fetch one scrip + expiry month of daily OI history from Kite and store it.
 * Used by POST /api/oi-history/fetch (which streams progress to the browser)
 * and by the after-close scheduler (which has no browser).
 */

import {
  createOiHistoryTable,
  getOiHistoryDatesForExpiryMonth,
  getOptionsForAtm,
  getOptionsForStrikes,
  getSpotToken,
  getStoredOiHistoryStrikes,
  getStrikeStepSize,
  insertOiHistoryFuturesRows,
  insertOiHistoryRows,
  withNamedAdvisoryLock,
} from './db.js';
import { getOrFetchInstruments } from './instruments.js';

/** Get current date in IST as YYYY-MM-DD */
export function todayIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  const d = String(ist.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A fetch that failed for a known reason; the message is safe to show the user. */
export class OiHistoryFetchError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'OiHistoryFetchError';
    this.status = status;
  }
}

/**
 * Fetches missing dates from the current month and always refreshes today.
 *
 * @param {object} options
 * @param {string} options.scrip          e.g. 'NIFTY50'
 * @param {string} options.expiryMonth    'YYYY-MM'
 * @param {string} [options.strikeMode]   'atmRange' | 'allStored' | 'specific'
 * @param {number} [options.specificStrike]
 * @param {string} options.apiKey
 * @param {string} options.accessToken
 * @param {(event: string, data: object) => void} [options.send]  progress callback
 * @param {AbortSignal} [options.signal]  stops Kite calls and skips the save
 * @returns {Promise<{ rowCount: number, tradingDays: number, skippedDays: number, fetchedDays: number, uniqueTokens: number, message?: string }>}
 */
export async function fetchOiHistoryMonth({
  scrip,
  expiryMonth,
  strikeMode = 'atmRange',
  specificStrike,
  apiKey,
  accessToken,
  send = () => {},
  signal,
}) {
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new Error('Client cancelled the request');
  };

  if (!scrip || !expiryMonth) {
    throw new OiHistoryFetchError('scrip and expiryMonth are required');
  }

  if (!/^\d{4}-\d{2}$/.test(expiryMonth)) {
    throw new OiHistoryFetchError('expiryMonth must be in YYYY-MM format');
  }

  const exactStrike = Number(specificStrike);
  if (strikeMode === 'specific' && (!Number.isFinite(exactStrike) || exactStrike <= 0)) {
    throw new OiHistoryFetchError('specificStrike must be a positive number');
  }

  // Date window: from the 1st of the CURRENT month up to today (or the end
  // of the selected expiry month, whichever is earlier). No fixed lookback.
  const today = todayIST();
  const from = `${today.slice(0, 7)}-01`;
  const [ey, em] = expiryMonth.split('-').map(Number);
  const expiryMonthEnd = `${expiryMonth}-${String(new Date(ey, em, 0).getDate()).padStart(2, '0')}`;
  const to = today < expiryMonthEnd ? today : expiryMonthEnd;

  const authHeader = `token ${apiKey}:${accessToken}`;

  // Determine scrip configuration dynamically
  // Index scrips have known spot tokens; stocks use their NSE EQ token
  const INDEX_SPOT_TOKENS = {
    NIFTY: 256265,
    BANKNIFTY: 260105,
  };

  // scripName is the name in the NFO instruments table
  // For indices: scrip="NIFTY50" → scripName="NIFTY", scrip="BANKNIFTY" → scripName="BANKNIFTY"
  // For stocks: scrip="RELIANCE" → scripName="RELIANCE"
  const scripName = scrip === 'NIFTY50' ? 'NIFTY' : scrip;

  const spotToken = INDEX_SPOT_TOKENS[scripName] || await getSpotToken(scripName);
  if (!spotToken) {
    throw new OiHistoryFetchError(`Cannot find spot token for ${scrip}. Ensure instruments are loaded.`);
  }

  const stepSize = await getStrikeStepSize(scripName);
  const range = 20;
  const fetchAllStoredStrikes = strikeMode === 'allStored';
  const fetchSpecificStrike = strikeMode === 'specific';

  await createOiHistoryTable();

  // Step 1: Fetch spot index daily candles for spot close. This is cheap and
  // gives the trading-day calendar, so cache skipping can avoid option calls.
  send('step', { step: 1, message: `Fetching ${scrip} spot data...` });

  const spotUrl = `https://api.kite.trade/instruments/historical/${spotToken}/day?from=${from}&to=${to}&oi=1`;
  const spotRes = await fetch(spotUrl, {
    headers: { Authorization: authHeader, 'X-Kite-Version': '3' },
    signal,
  });
  if (!spotRes.ok) {
    const body = await spotRes.text();
    throw new OiHistoryFetchError(`Failed to fetch ${scrip} index candles: ${body}`, spotRes.status);
  }

  const spotData = await spotRes.json();
  const spotCandles = spotData?.data?.candles;
  if (!spotCandles?.length) {
    return { rowCount: 0, tradingDays: 0, skippedDays: 0, fetchedDays: 0, uniqueTokens: 0 };
  }

  // Serialize fetches for the SAME scrip+expiryMonth across all users/replicas.
  // Different scrips/months lock independently and run fully in parallel.
  // A waiting caller re-checks stored dates inside the lock (below) and skips
  // whatever the previous caller just fetched — avoiding duplicate Kite calls.
  return withNamedAdvisoryLock(`oi-history:${scrip}:${expiryMonth}`, async () => {
    // Step 2: For each trading day, compute ATM. Past stored dates are skipped;
    // today is always refreshed because intraday OI can change until close.
    // This runs INSIDE the lock so a waiting caller sees the latest stored dates.
    const existingDates = fetchAllStoredStrikes || fetchSpecificStrike
      ? new Set()
      : await getOiHistoryDatesForExpiryMonth(scrip, expiryMonth, from, to);
    const storedStrikes = fetchAllStoredStrikes
      ? await getStoredOiHistoryStrikes(scrip, expiryMonth)
      : [];
    send('step', { step: 2, message: `Found ${spotCandles.length} trading days.` });

    const allDays = []; // all trading days from Kite
    for (const candle of spotCandles) {
      const date = candle[0].slice(0, 10);
      if (date !== today && existingDates.has(date)) continue;
      const spotClose = candle[4];
      const atm = Math.round(spotClose / stepSize) * stepSize;
      allDays.push({ date, spotClose, atm });
    }

    const skippedDays = spotCandles.length - allDays.length;
    // Option history only needs the missing option days. Futures history is
    // independent of option-row caching, so always fetch the full spot date
    // range. Otherwise the first production fetch can start several days
    // late when earlier option rows are already cached.
    const fetchFrom = allDays[0]?.date || spotCandles[0][0].slice(0, 10);
    const fetchTo = allDays[allDays.length - 1]?.date || spotCandles[spotCandles.length - 1][0].slice(0, 10);
    const futuresFetchFrom = spotCandles[0][0].slice(0, 10);
    const futuresFetchTo = spotCandles[spotCandles.length - 1][0].slice(0, 10);

    // Futures are stored separately from the strike-level option history.
    // Use the nearest futures contract in the selected expiry month.
    const instruments = await getOrFetchInstruments(apiKey, accessToken);
    const futuresContract = instruments
      .filter((inst) => inst.name === scripName && inst.exchange === 'NFO' && inst.instrumentType === 'FUT'
        && inst.expiry && inst.expiry.startsWith(expiryMonth) && inst.expiry >= today)
      .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
    if (futuresContract) {
      send('step', { step: 2, message: `Fetching futures OI and volume for ${futuresContract.tradingsymbol}...` });
      try {
        const futuresUrl = `https://api.kite.trade/instruments/historical/${futuresContract.instrumentToken}/day?from=${futuresFetchFrom}&to=${futuresFetchTo}&oi=1`;
        const futuresResponse = await fetch(futuresUrl, { headers: { Authorization: authHeader, 'X-Kite-Version': '3' }, signal });
        if (futuresResponse.ok) {
          const futuresCandles = (await futuresResponse.json())?.data?.candles || [];
          await insertOiHistoryFuturesRows(scrip, futuresCandles.map((candle) => ({
            expiry: futuresContract.expiry, date: candle[0].slice(0, 10),
            instrumentToken: futuresContract.instrumentToken, tradingsymbol: futuresContract.tradingsymbol,
            open: candle[1], high: candle[2], low: candle[3], close: candle[4], volume: candle[5], oi: candle[6] ?? 0,
          })));
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[OI History] Futures fetch failed:', err.message);
      }
    }

    if (allDays.length === 0) {
      return { rowCount: 0, tradingDays: spotCandles.length, skippedDays, fetchedDays: 0, uniqueTokens: 0 };
    }

    // Collect unique tokens needed across all days
    const uniqueTokens = new Map();
    const dayTokenSets = [];

    for (const { date, spotClose, atm } of allDays) {
      let optionsSource;
      if (fetchSpecificStrike) {
        optionsSource = await getOptionsForStrikes(scripName, [exactStrike], { targetMonth: expiryMonth });
      } else if (fetchAllStoredStrikes && storedStrikes.length > 0) {
        optionsSource = await getOptionsForStrikes(scripName, storedStrikes, { targetMonth: expiryMonth });
      } else {
        optionsSource = await getOptionsForAtm(scripName, atm, stepSize, range, { allExpiries: true, targetMonth: expiryMonth });
      }
      const options = optionsSource
        .filter((opt) => opt.expiry && opt.expiry >= date);
      const tokenSet = new Set();
      for (const opt of options) {
        tokenSet.add(opt.instrumentToken);
        if (!uniqueTokens.has(opt.instrumentToken)) {
          uniqueTokens.set(opt.instrumentToken, opt);
        }
      }
      dayTokenSets.push({ date, spotClose, tokens: tokenSet });
    }

    if (uniqueTokens.size === 0) {
      return { rowCount: 0, tradingDays: spotCandles.length, skippedDays, fetchedDays: 0, uniqueTokens: 0, message: 'No option instruments found. Ensure the server has loaded instruments today.' };
    }

    // Step 3: Fetch daily candles for each unique token (batches of 5, 300ms delay)
    send('step', { step: 3, message: `Fetching OI candles for ${uniqueTokens.size} instruments...` });

    const tokenCandles = new Map();
    const tokenList = [...uniqueTokens.keys()];
    const batchSize = 5;
    const totalBatches = Math.ceil(tokenList.length / batchSize);

    for (let i = 0; i < tokenList.length; i += batchSize) {
      throwIfCancelled();
      const batch = tokenList.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const promises = batch.map(async (token) => {
        try {
          const url = `https://api.kite.trade/instruments/historical/${token}/day?from=${fetchFrom}&to=${fetchTo}&oi=1`;
          const response = await fetch(url, {
            headers: { Authorization: authHeader, 'X-Kite-Version': '3' },
            signal,
          });
          if (!response.ok) return;

          const result = await response.json();
          const candles = result?.data?.candles;
          if (!candles?.length) return;

          const dateMap = new Map();
          for (const c of candles) {
            dateMap.set(c[0].slice(0, 10), c);
          }
          tokenCandles.set(token, dateMap);
        } catch {
          // Skip failed fetches
        }
      });

      await Promise.all(promises);

      // Send progress after each batch
      const done = Math.min(i + batchSize, tokenList.length);
      const lastToken = batch[batch.length - 1];
      const lastMeta = uniqueTokens.get(lastToken);
      send('progress', {
        done,
        total: tokenList.length,
        pct: Math.round((done / tokenList.length) * 100),
        batch: batchNum,
        totalBatches,
        symbol: lastMeta?.tradingsymbol || '',
      });

      if (i + batchSize < tokenList.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Step 4: Build rows and upsert
    throwIfCancelled();
    send('step', { step: 4, message: 'Saving to database...' });

    const rows = [];
    for (const { date, spotClose, tokens } of dayTokenSets) {
      for (const token of tokens) {
        const meta = uniqueTokens.get(token);
        const dateMap = tokenCandles.get(token);
        const candle = dateMap?.get(date);
        if (!candle || !meta) continue;

        rows.push({
          date,
          instrumentToken: token,
          tradingsymbol: meta.tradingsymbol,
          strike: meta.strike,
          optionType: meta.optionType,
          expiry: meta.expiry,
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5],
          oi: candle[6] ?? 0,
          spotClose,
        });
      }
    }

    // Upsert keyed on (scrip, date, instrument_token) — existing rows overwritten.
    const rowCount = await insertOiHistoryRows(scrip, rows);
    console.log(`[OI History] Fetched ${rowCount} rows for ${scrip} ${expiryMonth} (${allDays.length} fetched days, ${skippedDays} skipped days, ${uniqueTokens.size} tokens)`);

    return {
      rowCount,
      tradingDays: spotCandles.length,
      skippedDays,
      fetchedDays: allDays.length,
      uniqueTokens: uniqueTokens.size,
    };
  });
}
