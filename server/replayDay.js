/**
 * A replay day (pages/Replay): an underlying's 1-minute candles for one session and those of its nearest expiry's
 * options around the day's range, fetched from Kite with the caller's login when the day is opened. Nothing is stored.
 *
 * Kite serves no expired contract, so the options are the nearest expiry still live: the one the player would have
 * traded for recent days, a later one (higher premiums) for older days, and none once every contract live today
 * started after the day.
 */
import { getNearestExpiryOptions, getUnderlying } from './db.js';
import { fetchDayCandles, fetchMinuteCandles } from './kiteCandles.js';
import { addDays } from '../shared/marketTime.js';
import { replayDateProblem } from '../shared/replay.js';
import { OptionType } from '../shared/tradeEnums.js';

/** A day that can't be replayed, for a reason the player can act on; the message is safe to show. */
export class ReplayDayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplayDayError';
  }
}

/** Strikes kept beyond the ATM strikes the day reached, so the chain around ATM is complete at the extremes. */
const STRIKES_BEYOND_RANGE = 4;
/** Contracts are looked up this far (fraction of price) beyond the day's range, then trimmed to the strikes above. */
const STRIKE_LOOKUP_MARGIN = 0.1;
/** Kite allows 3 historical calls a second. */
const CALLS_PER_BATCH = 3;
const BATCH_GAP_MS = 1000;
/** Calendar days looked back for the previous session's close (covers long holiday breaks). */
const PREVIOUS_DAY_LOOKBACK_DAYS = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The contracts whose strikes span the ATM strikes from the day's low to its high, plus STRIKES_BEYOND_RANGE each side.
 * @template {{ strike: number }} C
 * @param {C[]} contracts
 * @param {number} low
 * @param {number} high
 * @returns {C[]}
 */
export function replayContracts(contracts, low, high) {
  const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
  if (!strikes.length) return [];
  const nearestIndex = (price) => strikes.reduce((best, strike, i) => (Math.abs(strike - price) < Math.abs(strikes[best] - price) ? i : best), 0);
  const first = strikes[Math.max(0, nearestIndex(low) - STRIKES_BEYOND_RANGE)];
  const last = strikes[Math.min(strikes.length - 1, nearestIndex(high) + STRIKES_BEYOND_RANGE)];
  return contracts.filter((c) => c.strike >= first && c.strike <= last);
}

/** Kite's candle time ('2026-11-26T09:15:00+0530') as 'HH:MM' IST. */
const minuteOf = (time) => String(time).slice(11, 16);

/**
 * A contract's candles on the index's minutes as [open, close, volume, oi]. A minute without a trade repeats the last
 * close with no volume; minutes before the first trade are null.
 */
function alignedSeries(times, candles) {
  const byMinute = new Map((candles ?? []).map((c) => [minuteOf(c[0]), c]));
  let last = null;
  return times.map((time) => {
    const c = byMinute.get(time);
    if (c) {
      last = c;
      return [c[1], c[4], c[5], c[6] ?? 0];
    }
    return last ? [last[4], last[4], 0, last[6] ?? 0] : null;
  });
}

/**
 * The replay day the browser plays: times ('HH:MM'), index candles [open, high, low, close], and per strike the call
 * and put series [open, close, volume, oi] on those minutes, with each contract's tradingsymbol.
 */
export function buildReplayDay({ underlying, date, index, contracts, candlesByToken, prevDay }) {
  const times = index.map((c) => minuteOf(c[0]));
  const traded = contracts.filter((c) => candlesByToken.get(c.instrumentToken)?.length);
  const strikes = [...new Set(traded.map((c) => c.strike))].sort((a, b) => a - b);
  /** @type {Record<string, (number[] | null)[]>} */ const calls = {};
  /** @type {Record<string, (number[] | null)[]>} */ const puts = {};
  /** @type {Record<string, { CE?: string, PE?: string }>} */ const symbols = {};
  for (const contract of traded) {
    const series = alignedSeries(times, candlesByToken.get(contract.instrumentToken));
    (contract.instrumentType === OptionType.CE ? calls : puts)[contract.strike] = series;
    symbols[contract.strike] = { ...symbols[contract.strike], [contract.instrumentType]: contract.tradingsymbol };
  }
  const complete = strikes.filter((strike) => calls[strike] && puts[strike]);
  return {
    underlying: underlying.name,
    label: underlying.label,
    date,
    expiry: contracts[0]?.expiry ?? null,
    lotSize: contracts[0]?.lotSize ?? null,
    prevClose: prevDay?.close ?? null,
    prevDay,
    times,
    index: index.map((c) => [c[1], c[2], c[3], c[4]]),
    strikes: complete,
    calls: Object.fromEntries(complete.map((s) => [s, calls[s]])),
    puts: Object.fromEntries(complete.map((s) => [s, puts[s]])),
    symbols: Object.fromEntries(complete.map((s) => [s, symbols[s]])),
  };
}

/** Each contract's minute candles with OI, a few calls a second; a contract Kite refuses is left out unless the login ended. */
async function fetchContractCandles(kite, contracts, date, signal) {
  const candlesByToken = new Map();
  for (let i = 0; i < contracts.length; i += CALLS_PER_BATCH) {
    signal?.throwIfAborted();
    await Promise.all(contracts.slice(i, i + CALLS_PER_BATCH).map(async (contract) => {
      try {
        candlesByToken.set(contract.instrumentToken, await fetchMinuteCandles(kite, contract.instrumentToken, date, { oi: true, signal }));
      } catch (err) {
        if (err.authFailure || signal?.aborted) throw err;
      }
    }));
    if (i + CALLS_PER_BATCH < contracts.length) await sleep(BATCH_GAP_MS);
  }
  return candlesByToken;
}

async function previousDay(kite, instrumentToken, date, signal) {
  try {
    const candles = await fetchDayCandles(kite, instrumentToken, addDays(date, -PREVIOUS_DAY_LOOKBACK_DAYS), addDays(date, -1), { signal });
    if (!candles?.length) return null;
    const [, , high, low, close] = candles.at(-1);
    return { high: Number(high), low: Number(low), close: Number(close) };
  } catch (err) {
    if (err.authFailure) throw err;
    return null;
  }
}

/**
 * Fetches the replay day of `underlyingName` on `date` with the caller's Kite login.
 * Throws ReplayDayError for a day that can't be replayed, and Kite's error (authFailure when the login ended) otherwise.
 * @param {{ kite: { apiKey: string, accessToken: string }, underlyingName: string, date: string, signal?: AbortSignal, now?: Date }} options
 */
export async function fetchReplayDay({ kite, underlyingName, date, signal, now = new Date() }) {
  const problem = replayDateProblem(date, now);
  if (problem) throw new ReplayDayError(problem);
  const underlying = await getUnderlying(underlyingName);
  if (!underlying?.instrumentToken) throw new ReplayDayError(`${underlyingName} has no price data to replay`);

  const index = await fetchMinuteCandles(kite, underlying.instrumentToken, date, { signal });
  if (!index?.length) throw new ReplayDayError(`Kite has no minute candles for ${underlying.label} on ${date}`);
  const low = Math.min(...index.map((c) => Number(c[3])));
  const high = Math.max(...index.map((c) => Number(c[2])));

  const contracts = replayContracts(
    await getNearestExpiryOptions(underlying.name, date, low * (1 - STRIKE_LOOKUP_MARGIN), high * (1 + STRIKE_LOOKUP_MARGIN)),
    low,
    high,
  );
  if (!contracts.length) throw new ReplayDayError(`${underlying.label} has no live option contracts to replay with`);

  const candlesByToken = await fetchContractCandles(kite, contracts, date, signal);
  const day = buildReplayDay({
    underlying, date, index, contracts, candlesByToken, prevDay: await previousDay(kite, underlying.instrumentToken, date, signal),
  });
  if (!day.strikes.length) {
    throw new ReplayDayError(`Kite no longer serves ${underlying.label}'s options for ${date}: the nearest contract still trading (${contracts[0].expiry} expiry) had not started then. Pick a later day.`);
  }
  return day;
}
