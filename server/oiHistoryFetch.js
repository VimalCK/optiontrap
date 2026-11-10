/**
 * Fetch one scrip + expiry month of daily OI history from Kite and store it.
 * Used by POST /api/oi-history/fetch (which streams progress to the browser)
 * and by the after-close scheduler (which has no browser).
 *
 * OI history is shared by every user, so callers asking for the same scrip,
 * month and strikes at once share one fetch (server/sharedRuns.js), and fetches
 * for the same month wait their turn in memory before taking the database lock,
 * so waiting never holds one of the pool's connections.
 */

import {
  createOiHistoryTable,
  getOiHistoryDatesForExpiryMonth,
  getOptionsForAtm,
  getOptionsForStrikes,
  getUnderlying,
  getStoredOiHistoryStrikes,
  getStrikeStepSize,
  insertOiHistoryFuturesRows,
  insertOiHistoryRows,
  withNamedAdvisoryLock,
} from './db.js';
import { getOrFetchInstruments } from './instruments.js';
import { createKeyedQueue, createSharedRuns } from './sharedRuns.js';
import { marketDate } from '../shared/marketTime.js';

/** Get current date in IST as YYYY-MM-DD */
export function todayIST() {
  return marketDate();
}

/** A fetch that failed for a known reason; the message is safe to show the user. */
export class OiHistoryFetchError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'OiHistoryFetchError';
    this.status = status;
  }
}

const sharedFetches = createSharedRuns();
const monthQueue = createKeyedQueue();

/** Requests with the same key fetch the same rows, so they can share one run. */
export function oiHistoryFetchKey({ scrip, expiryMonth, strikeMode = 'atmRange', specificStrike }) {
  return [scrip, expiryMonth, strikeMode, strikeMode === 'specific' ? Number(specificStrike) : ''].join('|');
}

/**
 * Fetch one month of OI history, or join the same fetch if one is already running.
 * A joined run that fails (e.g. on its starter's Kite login) is run again with this
 * caller's own login, so one user's error never reaches another.
 * Options and result are those of fetchOiHistoryMonthNow.
 */
export async function fetchOiHistoryMonth(options) {
  const { send = () => {}, signal } = options;
  const key = oiHistoryFetchKey(options);
  const work = ({ emit, signal: runSignal }) => fetchOiHistoryMonthNow({ ...options, send: emit, signal: runSignal });

  const joined = sharedFetches.join(key, work, { onEvent: send, signal });
  if (!joined.started) send('step', { step: 0, message: 'Joining a fetch already running for this month...' });
  try {
    return await joined.result;
  } catch (err) {
    if (joined.started || signal?.aborted) throw err;
    return sharedFetches.join(key, work, { onEvent: send, signal }).result;
  }
}

/**
 * Fetches missing dates from the current month and always refreshes today.
 *
 * @param {object} options
 * @param {string} options.scrip          F&O name, e.g. 'NIFTY'
 * @param {string} options.expiryMonth    'YYYY-MM'
 * @param {string} [options.strikeMode]   'atmRange' | 'allStored' | 'specific'
 * @param {number} [options.specificStrike]
 * @param {string} options.apiKey
 * @param {string} options.accessToken
 * @param {(event: string, data: object) => void} [options.send]  progress callback
 * @param {AbortSignal} [options.signal]  stops Kite calls and skips the save
 * @returns {Promise<{ rowCount: number, tradingDays: number, skippedDays: number, fetchedDays: number, uniqueTokens: number, message?: string }>}
 */
export async function fetchOiHistoryMonthNow({
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

  // scrip is the F&O name the contracts carry ("NIFTY", "RELIANCE"); its spot
  // is its price row (the index row, or the stock's NSE row).
  const spotToken = (await getUnderlying(scrip))?.instrumentToken;
  if (!spotToken) {
    throw new OiHistoryFetchError(`Cannot find spot token for ${scrip}. Ensure instruments are loaded.`);
  }

  const stepSize = await getStrikeStepSize(scrip);
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
  // In-process fetches for this month queue in memory first, so only one at a time waits on the lock.
  const lockName = `oi-history:${scrip}:${expiryMonth}`;
  return monthQueue.run(lockName, () => {
    throwIfCancelled();
    return withNamedAdvisoryLock(lockName, () => fetchMissingDays());
  });

  async function fetchMissingDays() {
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
      .filter((inst) => inst.name === scrip && inst.exchange === 'NFO' && inst.instrumentType === 'FUT'
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
        optionsSource = await getOptionsForStrikes(scrip, [exactStrike], { targetMonth: expiryMonth });
      } else if (fetchAllStoredStrikes && storedStrikes.length > 0) {
        optionsSource = await getOptionsForStrikes(scrip, storedStrikes, { targetMonth: expiryMonth });
      } else {
        optionsSource = await getOptionsForAtm(scrip, atm, stepSize, range, { allExpiries: true, targetMonth: expiryMonth });
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
  }
}
