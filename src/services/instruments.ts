/**
 * Instrument Search Service
 *
 * Fetches the instrument list from the server (NSE equities + NIFTY F&O).
 * The server caches in SQLite, shared across all users.
 * Provides a fast prefix-match search for the watchlist "add instrument" UI.
 */

export interface Instrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingsymbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
  strike: number | null;
  expiry: string | null;
  lotSize: number | null;
}

/** In-memory cache to avoid repeated server calls within same session */
let memoryCache: Instrument[] | null = null;

/**
 * Load instruments from server. The server handles daily caching in SQLite
 * and deduplicates concurrent Kite API calls across all users.
 */
export async function loadInstruments(): Promise<Instrument[]> {
  if (memoryCache) return memoryCache;

  const res = await fetch('/instruments', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch instruments (${res.status})`);

  const json = await res.json();
  memoryCache = json.data as Instrument[];
  return memoryCache;
}

/**
 * Format a short expiry label from a date string (e.g. "2025-06-26" → "26Jun").
 */
function formatExpiry(expiry: string): string {
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return expiry;
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}${months[d.getMonth()]}`;
}

/**
 * Build a display label for an instrument.
 * EQ: "RELIANCE"
 * Options: "NIFTY 25000 CE 26Jun"
 * Futures: "NIFTY FUT 26Jun"
 */
export function getDisplayLabel(inst: Instrument): string {
  if (inst.instrumentType === 'EQ') return inst.tradingsymbol;

  const expLabel = inst.expiry ? formatExpiry(inst.expiry) : '';

  if (inst.instrumentType === 'FUT') {
    return `${inst.name} FUT ${expLabel}`.trim();
  }

  // CE or PE
  const strike = inst.strike ? inst.strike.toFixed(0) : '';
  return `${inst.name} ${strike} ${inst.instrumentType} ${expLabel}`.trim();
}

/**
 * Prefix-match search across tradingsymbol, company name, and strike.
 * Returns up to `limit` matches sorted by relevance.
 */
export function searchInstruments(
  instruments: Instrument[],
  query: string,
  limit = 20,
): Instrument[] {
  if (!query.trim()) return [];

  const q = query.trim().toUpperCase();

  const matches = instruments.filter((inst) => {
    if (inst.tradingsymbol.toUpperCase().includes(q)) return true;
    if (inst.name.toUpperCase().includes(q)) return true;
    if (inst.strike && String(inst.strike).includes(q)) return true;
    return false;
  });

  matches.sort((a, b) => {
    const aPrefix = a.tradingsymbol.toUpperCase().startsWith(q) || a.name.toUpperCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.tradingsymbol.toUpperCase().startsWith(q) || b.name.toUpperCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;

    // Stocks before options for same-name prefix
    const aIsEq = a.instrumentType === 'EQ' ? 0 : 1;
    const bIsEq = b.instrumentType === 'EQ' ? 0 : 1;
    if (aIsEq !== bIsEq) return aIsEq - bIsEq;

    return a.tradingsymbol.length - b.tradingsymbol.length;
  });

  return matches.slice(0, limit);
}
