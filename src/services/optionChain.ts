export interface OptionInstrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingsymbol: string;
  name: string;
  expiry: string;
  strike: number;
  instrumentType: 'CE' | 'PE';
  lotSize: number;
  lastPrice: number;
}

export interface OptionChainRow {
  strike: number;
  ce: OptionInstrument | null;
  pe: OptionInstrument | null;
}
import { apiClient } from './apiClient';
import { istDateString } from '@/utils/marketStatus';

/** In-memory cache of all instruments to avoid re-fetching */
let instrumentsCache: any[] | null = null;

/**
 * Fetch options for a given symbol from the server's shared instrument cache.
 * The server fetches from Kite once per day and caches in SQLite.
 */
export async function fetchOptions(symbol: string, signal?: AbortSignal): Promise<OptionInstrument[]> {
  if (!instrumentsCache) {
    instrumentsCache = await apiClient.get<any[]>('/instruments', { signal });
  }

  // Filter for the given symbol's CE/PE options
  return instrumentsCache!
    .filter((i: any) => i.exchange === 'NFO' && i.name === symbol && (i.instrumentType === 'CE' || i.instrumentType === 'PE'))
    .map((i: any) => ({
      instrumentToken: i.instrumentToken,
      exchangeToken: i.exchangeToken,
      tradingsymbol: i.tradingsymbol,
      name: i.name,
      expiry: i.expiry,
      strike: i.strike,
      instrumentType: i.instrumentType as 'CE' | 'PE',
      lotSize: i.lotSize || 0,
      lastPrice: i.lastPrice || 0,
    }));
}

/**
 * Look up the lot size for an instrument token from the cache.
 */
export function getLotSize(instrumentToken: number): number {
  if (!instrumentsCache) return 1;
  const inst = instrumentsCache.find((i: any) => i.instrumentToken === instrumentToken);
  return inst?.lotSize || 1;
}

/**
 * Get unique expiry dates sorted ascending
 */
export function getExpiries(options: OptionInstrument[]): string[] {
  // Expiries are YYYY-MM-DD, so they compare as strings against today's IST date.
  const today = istDateString();
  return [...new Set(options.map((o) => o.expiry))]
    .filter((exp) => exp.slice(0, 10) >= today)
    .sort();
}

/**
 * Build option chain rows for a given expiry
 */
export function buildOptionChain(options: OptionInstrument[], expiry: string): OptionChainRow[] {
  const filtered = options.filter((o) => o.expiry === expiry);
  const strikeMap = new Map<number, { ce: OptionInstrument | null; pe: OptionInstrument | null }>();

  for (const opt of filtered) {
    if (!strikeMap.has(opt.strike)) {
      strikeMap.set(opt.strike, { ce: null, pe: null });
    }
    const row = strikeMap.get(opt.strike)!;
    if (opt.instrumentType === 'CE') row.ce = opt;
    else row.pe = opt;
  }

  return Array.from(strikeMap.entries())
    .map(([strike, { ce, pe }]) => ({ strike, ce, pe }))
    .sort((a, b) => a.strike - b.strike);
}
