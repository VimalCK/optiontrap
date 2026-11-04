import { apiClient } from './apiClient';

/** An F&O underlying with its price instrument and settings (GET /api/underlyings). */
export interface Underlying {
  /** F&O name the option contracts carry, e.g. "NIFTY", "RELIANCE". */
  name: string;
  label: string;
  /** Price instrument; null when none is known for the name. */
  instrumentToken: number | null;
  exchange: string | null;
  tradingsymbol: string | null;
  tradingviewSymbol: string | null;
  alwaysSnapshot: boolean;
  isMarketReference: boolean;
}

export function fetchUnderlyings(signal?: AbortSignal): Promise<Underlying[]> {
  return apiClient.get<Underlying[]>('/api/underlyings', { signal });
}

let shared: Promise<Underlying[]> | null = null;
let sharedValue: Underlying[] | null = null;

/**
 * The underlyings, fetched once and shared (TradingView links, Positions).
 * A failed fetch is retried on the next call.
 */
export function loadUnderlyings(): Promise<Underlying[]> {
  shared ??= fetchUnderlyings().then((list) => (sharedValue = list), (err) => { shared = null; throw err; });
  return shared;
}

/** The shared list if it has loaded, else null. */
export function loadedUnderlyings(): Underlying[] | null {
  return sharedValue;
}

/** Admin: snapshot this underlying's option chain every trading day, or not. */
export function setAlwaysSnapshot(name: string, alwaysSnapshot: boolean): Promise<Underlying> {
  return apiClient.patch<Underlying>(`/api/admin/underlyings/${encodeURIComponent(name)}`, { alwaysSnapshot });
}
