/**
 * A stored close that no longer matches Kite's means Kite adjusted past prices for a split or bonus, so the whole
 * history is fetched again. Only completed sessions are stored: today's candle waits for the 15:45 IST close.
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
import { KiteApiError, kiteClient } from './kiteClient.js';
import { SETUP_BACKFILL_DAYS, analyzeStock, evaluateSetup, parseKiteCandles, replaySetups, scanSummary } from '../shared/stockSetups.js';

/** One day under Kite's 2000-day limit for daily candles. */
const HISTORY_DAYS = 1999;
/** Calendar days re-fetched on each update: about five sessions. */
const OVERLAP_DAYS = 7;
/** A re-fetched close further than this from the stored one means Kite rewrote history. */
const REWRITE_TOLERANCE = 0.01;
const RATE_LIMIT_RETRY_MS = 1000;
/** Kite's "too many requests" status. */
const RATE_LIMITED = 429;

/** A Kite fetch that failed; `status` is Kite's HTTP status when there was one, `authFailure` whether it ended the login. */
export class StockCandleError extends Error {
  constructor(message, status = null, authFailure = false) {
    super(message);
    this.name = 'StockCandleError';
    this.status = status;
    this.authFailure = authFailure;
  }
}

/** Why a candle sync failed, in words safe to show the user: Kite's HTTP status, never Kite's or the database's own text. */
export function candleSyncWarning(err) {
  return err instanceof StockCandleError && err.status ? `Kite answered ${err.status}` : 'server error';
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

/** One stock's daily candles from Kite; a rate-limited (429) call is tried once more after a pause. */
async function fetchKiteDaily(instrumentToken, from, to, kite, { signal, retried = false } = {}) {
  try {
    const data = await kiteClient(kite).get(`/instruments/historical/${instrumentToken}/day?from=${from}&to=${to}`, { signal });
    return parseKiteCandles(data?.candles || []);
  } catch (err) {
    if (!(err instanceof KiteApiError)) throw err;
    if (err.status === RATE_LIMITED && !retried) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
      return fetchKiteDaily(instrumentToken, from, to, kite, { signal, retried: true });
    }
    throw new StockCandleError(`Kite historical data: ${err.message}`, err.status, err.authFailure);
  }
}

/**
 * @returns {Promise<{ fetched: number, full: boolean, skipped: boolean }>}
 */
export async function syncStockCandles(instrumentToken, kite, { now = new Date(), signal } = {}) {
  return withNamedAdvisoryLock(`stock-candles:${instrumentToken}`, async () => {
    const sync = await getStockCandleSync(instrumentToken);
    if (sync && sync.checkedAt >= lastSettledAt(now)) return { fetched: 0, full: false, skipped: true };

    const today = istClock(now).date;
    if (sync?.latestCandleDate) {
      const from = daysBefore(sync.latestCandleDate, OVERLAP_DAYS);
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
 * @param {{ instrumentToken: number, tradingsymbol: string }} stock
 * @param {Array<{ date: string, close: number }>} marketCandles  the market reference index; empty skips the market check
 */
export async function scanStock(stock, marketCandles) {
  const candles = await getStockCandles(stock.instrumentToken);
  const analysis = analyzeStock(candles, { market: marketCandles });
  if (!analysis) return null;

  await saveStockScan(stock.instrumentToken, scanSummary(analysis));
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

/**
 * Fill the setup scorecard from one stock's stored history: record the setups the
 * past year's sessions would have shown, with how each turned out. Setups already
 * recorded are kept, so running it again only adds what's missing.
 * @param {{ instrumentToken: number, tradingsymbol: string }} stock
 * @returns {Promise<{ found: number, target: number, stop: number, expired: number, open: number }>}
 */
export async function backfillStockSetups(stock) {
  const candles = await getStockCandles(stock.instrumentToken);
  const latest = candles[candles.length - 1];
  const found = latest ? replaySetups(candles, daysBefore(latest.date, SETUP_BACKFILL_DAYS)) : [];

  await insertStockSetupSignals(found.map((s) => ({
    instrumentToken: stock.instrumentToken,
    tradingsymbol: stock.tradingsymbol,
    signalDate: s.date,
    setupType: s.type,
    direction: s.direction,
    entry: s.entry,
    stop: s.stop,
    target: s.target,
    outcome: s.outcome,
  })));

  const counts = { found: found.length, target: 0, stop: 0, expired: 0, open: 0 };
  for (const s of found) counts[s.outcome.status]++;
  return counts;
}
