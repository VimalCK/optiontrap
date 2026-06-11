/**
 * Instrument Search Service
 *
 * Fetches the NSE equity instrument list from the server (which caches it
 * in SQLite, shared across all users). Provides a fast prefix-match search
 * for the watchlist "add instrument" UI.
 */

export interface Instrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingsymbol: string;
  name: string;
  exchange: string;
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
 * Prefix-match search across tradingsymbol and company name.
 * Returns up to `limit` matches sorted by relevance (prefix first, then symbol length).
 */
export function searchInstruments(
  instruments: Instrument[],
  query: string,
  limit = 20,
): Instrument[] {
  if (!query.trim()) return [];

  const q = query.trim().toUpperCase();

  const matches = instruments.filter(
    (inst) =>
      inst.tradingsymbol.toUpperCase().includes(q) ||
      inst.name.toUpperCase().includes(q),
  );

  matches.sort((a, b) => {
    const aPrefix = a.tradingsymbol.toUpperCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.tradingsymbol.toUpperCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.tradingsymbol.length - b.tradingsymbol.length;
  });

  return matches.slice(0, limit);
}
