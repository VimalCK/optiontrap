/**
 * Daily candles for watchlist stocks.
 *
 * A stock's history is fetched from Kite once in full (Kite serves up to 2000
 * days of daily candles per request), then only the last few sessions on each
 * update. Re-fetching a short overlap catches late corrections, and a stored
 * close that no longer matches means Kite adjusted past prices for a split or
 * bonus, so the whole history is fetched again. Only completed sessions are
 * stored: today's candle waits for the 15:45 IST close.
 *
 * scanStock() then re-runs the shared setup engine on the stored candles,
 * saves the watchlist summary, records the day's setups, and moves open setups
 * forward to their target, stop or expiry.
 */

import {
  getOpenStockSetupSignals,
  getStockCandleSync,
  getStockCandles,
  insertStockSetupSignals,
  saveStockCandles,
  saveStockScan,
  updateStockSetupSignal,
  withNamedAdvisoryLock,
} from './db.js';
import { AFTER_CLOSE_MINUTES, daysBefore, istClock } from './marketClock.js';
import { analyzeStock, evaluateSetup, parseKiteCandles, scanSummary } from '../shared/stockSetups.js';

/** One day under Kite's 2000-day limit for daily candles. */
export const HISTORY_DAYS = 1999;
/** Calendar days re-fetched on each update: about five sessions. */
const OVERLAP_DAYS = 7;
/** A re-fetched close further than this from the stored one means Kite rewrote history. */
const REWRITE_TOLERANCE = 0.01;
const RATE_LIMIT_RETRY_MS = 1000;

/** A Kite fetch that failed; `status` is Kite's HTTP status when there was one. */
export class StockCandleError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'StockCandleError';
    this.status = status;
  }
}

/**
 * Epoch ms of the latest moment Kite's daily candles settled: the most recent
 * weekday 15:45 IST at or before `now`. A stock checked after that needs no new fetch.
 */
export function lastSettledAt(now = new Date()) {
  const { date, weekday, minutes } = istClock(now);
  let day = date;
  let wd = weekday;
  if (!(wd >= 1 && wd <= 5 && minutes >= AFTER_CLOSE_MINUTES)) {
    do {
      day = daysBefore(day, 1);
      wd = (wd + 6) % 7;
    } while (wd === 0 || wd === 6);
  }
  const [y, m, d] = day.split('-').map(Number);
  // 15:45 IST is 10:15 UTC.
  return Date.UTC(y, m - 1, d, 10, 15);
}

/** Completed sessions only: today's candle is dropped until the close has settled. */
export function completedCandles(candles, now = new Date()) {
  const { date, weekday, minutes } = istClock(now);
  const settledToday = weekday >= 1 && weekday <= 5 && minutes >= AFTER_CLOSE_MINUTES;
  return settledToday ? candles : candles.filter((c) => c.date < date);
}

/** True when re-fetched days disagree with stored closes: Kite has adjusted the history. */
export function historyRewritten(stored, fetched) {
  const storedClose = new Map(stored.map((c) => [c.date, c.close]));
  return fetched.some((c) => {
    const close = storedClose.get(c.date);
    return close !== undefined && Math.abs(c.close / close - 1) > REWRITE_TOLERANCE;
  });
}

async function fetchKiteDaily(instrumentToken, from, to, kite, { signal, retried = false } = {}) {
  const res = await fetch(`https://api.kite.trade/instruments/historical/${instrumentToken}/day?from=${from}&to=${to}`, {
    headers: { Authorization: `token ${kite.apiKey}:${kite.accessToken}`, 'X-Kite-Version': '3' },
    signal,
  });
  if (res.status === 429 && !retried) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
    return fetchKiteDaily(instrumentToken, from, to, kite, { signal, retried: true });
  }
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try { message = JSON.parse(body).message || body; } catch { /* not JSON */ }
    throw new StockCandleError(`Kite historical data: ${message}`, res.status);
  }
  const json = await res.json();
  return parseKiteCandles(json?.data?.candles || []);
}

/**
 * Bring one stock's stored candles up to date with the given Kite session.
 * @returns {Promise<{ fetched: number, full: boolean, skipped: boolean }>}
 */
export async function syncStockCandles(instrumentToken, kite, { now = new Date(), signal } = {}) {
  return withNamedAdvisoryLock(`stock-candles:${instrumentToken}`, async () => {
    const sync = await getStockCandleSync(instrumentToken);
    if (sync && sync.checkedAt >= lastSettledAt(now)) return { fetched: 0, full: false, skipped: true };

    const today = istClock(now).date;
    if (sync?.lastDate) {
      const from = daysBefore(sync.lastDate, OVERLAP_DAYS);
      const fetched = completedCandles(await fetchKiteDaily(instrumentToken, from, today, kite, { signal }), now);
      const stored = (await getStockCandles(instrumentToken)).filter((c) => c.date >= from);
      if (!historyRewritten(stored, fetched)) {
        await saveStockCandles(instrumentToken, fetched);
        return { fetched: fetched.length, full: false, skipped: false };
      }
    }

    const all = completedCandles(await fetchKiteDaily(instrumentToken, daysBefore(today, HISTORY_DAYS), today, kite, { signal }), now);
    await saveStockCandles(instrumentToken, all, { replace: true });
    return { fetched: all.length, full: true, skipped: false };
  });
}

/**
 * Re-scan one stock from its stored candles.
 * @param {{ instrumentToken: number, tradingsymbol: string }} stock
 * @param {Array<{ date: string, close: number }>} marketCandles  NIFTY 50, for the market check
 */
export async function scanStock(stock, marketCandles) {
  const candles = await getStockCandles(stock.instrumentToken);
  const analysis = analyzeStock(candles, { market: marketCandles });
  if (!analysis) return null;

  await saveStockScan(stock.instrumentToken, analysis.date, scanSummary(analysis));
  await insertStockSetupSignals(analysis.setups.map((s) => ({
    instrumentToken: stock.instrumentToken,
    tradingsymbol: stock.tradingsymbol,
    signalDate: s.date,
    setupType: s.type,
    direction: s.direction,
    entry: s.entry,
    stop: s.stop,
    target: s.target,
  })));

  for (const signal of await getOpenStockSetupSignals(stock.instrumentToken)) {
    const after = candles.filter((c) => c.date > signal.signalDate);
    if (after.length) await updateStockSetupSignal(signal.id, evaluateSetup(signal, after));
  }
  return analysis;
}
