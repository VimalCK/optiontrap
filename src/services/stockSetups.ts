/**
 * Watchlist stock setups: daily candles and scan results from the server.
 *
 * The analysis itself runs in the browser with the same engine the server's
 * after-close scan uses (shared/stockSetups.js), so the panel and the Setups
 * column always agree.
 */
import { apiClient } from './apiClient';
import { parseKiteCandles, scanSummary, type Candle, type SetupType } from '../../shared/stockSetups.js';

export interface StockCandles {
  stock: { instrumentToken: number; tradingsymbol: string };
  candles: Candle[];
  /** NIFTY 50, for the market check. */
  market: Candle[];
  /** Set when Kite couldn't be reached and stored candles were returned instead. */
  warning: string | null;
}

export type ScanSummary = ReturnType<typeof scanSummary>;

export interface SetupStats {
  setupType: SetupType;
  direction: 'buy' | 'sell';
  total: number;
  open: number;
  target: number;
  stop: number;
  expired: number;
  avgFavorablePct: number | null;
  avgAdversePct: number | null;
}

export interface TrackedSetup {
  id: number;
  instrumentToken: number;
  tradingsymbol: string;
  signalDate: string;
  setupType: SetupType;
  direction: 'buy' | 'sell';
  entry: number;
  stop: number;
  target: number;
  status: 'open' | 'target' | 'stop' | 'expired';
  resolvedDate: string | null;
  sessionsHeld: number;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
}

type CompactCandle = [string, number, number, number, number, number];

/** IST date: cached candles are reused for the rest of the trading day. */
const istDate = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const cache = new Map<number, { day: string; data: Promise<StockCandles> }>();

/** Resolves like `promise`, but rejects with an AbortError as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * One stock's daily candles and NIFTY 50's, cached in memory for the day.
 *
 * The shared request is never tied to a caller's signal: aborting one caller
 * (e.g. a StrictMode remount) would otherwise hand the next caller a cancelled
 * request. `signal` only stops this caller waiting.
 */
export function fetchStockCandles(instrumentToken: number, signal?: AbortSignal): Promise<StockCandles> {
  const day = istDate();
  const hit = cache.get(instrumentToken);
  if (hit && hit.day === day) return untilAborted(hit.data, signal);

  const data = apiClient
    .get<{ stock: StockCandles['stock']; candles: CompactCandle[]; market: CompactCandle[]; warning: string | null }>(
      `/api/stocks/${instrumentToken}/candles`,
    )
    .then((raw) => ({ stock: raw.stock, candles: parseKiteCandles(raw.candles), market: parseKiteCandles(raw.market), warning: raw.warning }));
  cache.set(instrumentToken, { day, data });
  // Don't keep a failed request: the next open should try again.
  data.catch(() => { if (cache.get(instrumentToken)?.data === data) cache.delete(instrumentToken); });
  return untilAborted(data, signal);
}

/** Latest scan per stock in the user's watchlists, by instrument token. */
export async function fetchStockScans(signal?: AbortSignal): Promise<Map<number, ScanSummary>> {
  const scans = await apiClient.get<{ instrumentToken: number; summary: ScanSummary }[]>('/api/stocks/scans', { signal });
  return new Map(scans.map((s) => [s.instrumentToken, s.summary]));
}

export function fetchSetupScorecard(signal?: AbortSignal): Promise<{ stats: SetupStats[]; recent: TrackedSetup[] }> {
  return apiClient.get('/api/stocks/setups', { signal });
}
