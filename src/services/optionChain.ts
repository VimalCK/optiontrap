export interface OptionInstrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingsymbol: string;
  name: string;
  expiry: string;
  strike: number;
  instrumentType: OptionTypeId;
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
import { buildOptionChain as buildChain, upcomingExpiries } from '../../shared/optionAnalysis/chain.js';
import { Exchange, isOptionType, type OptionTypeId } from '../../shared/tradeEnums.js';

/** In-memory cache of all instruments to avoid re-fetching */
let instrumentsCache: any[] | null = null;

/**
 * Fetch options for a given symbol from the server's shared instrument cache.
 * The server fetches from Kite once per day and caches in SQLite.
 */
export async function fetchOptions(symbol: string, signal?: AbortSignal): Promise<OptionInstrument[]> {
  if (!instrumentsCache) {
    instrumentsCache = await apiClient.get<any[]>('/api/instruments', { signal });
  }

  // Filter for the given symbol's CE/PE options
  return instrumentsCache!
    .filter((i: any) => i.exchange === Exchange.NFO && i.name === symbol && isOptionType(i.instrumentType))
    .map((i: any) => ({
      instrumentToken: i.instrumentToken,
      exchangeToken: i.exchangeToken,
      tradingsymbol: i.tradingsymbol,
      name: i.name,
      expiry: i.expiry,
      strike: i.strike,
      instrumentType: i.instrumentType as OptionTypeId,
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
  return upcomingExpiries(options, istDateString());
}

/**
 * Build option chain rows for a given expiry
 */
export function buildOptionChain(options: OptionInstrument[], expiry: string): OptionChainRow[] {
  return buildChain(options, expiry);
}
