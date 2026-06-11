/**
 * Instrument Search Service
 *
 * Fetches the full NSE equity instrument list from Kite's CSV, caches it
 * daily in IndexedDB, and provides a fast prefix-match search function
 * for the watchlist "add instrument" UI.
 */

import { dbGet, dbSet, STORE_APP } from './db';

export interface Instrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingsymbol: string;
  name: string;
  exchange: string;
}

const CACHE_KEY = 'instruments_cache';

interface InstrumentCache {
  date: string;
  instruments: Instrument[];
}

function getTodayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

/** In-memory cache to avoid repeated IndexedDB reads */
let memoryCache: Instrument[] | null = null;
let memoryCacheDate: string | null = null;

/**
 * Load instruments — from memory, IndexedDB, or Kite CSV (in that order).
 */
export async function loadInstruments(): Promise<Instrument[]> {
  const today = getTodayIST();

  // 1. In-memory cache (same day)
  if (memoryCache && memoryCacheDate === today) return memoryCache;

  // 2. IndexedDB cache (same day)
  const cached = await dbGet<InstrumentCache>(STORE_APP, CACHE_KEY);
  if (cached && cached.date === today) {
    memoryCache = cached.instruments;
    memoryCacheDate = today;
    return memoryCache;
  }

  // 3. Fetch fresh from Kite API
  const response = await fetch('/api/instruments/NSE', { credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to fetch instruments (${response.status})`);

  const csv = await response.text();
  const instruments = parseInstruments(csv);

  // Cache in IndexedDB
  await dbSet<InstrumentCache>(STORE_APP, CACHE_KEY, { date: today, instruments });
  memoryCache = instruments;
  memoryCacheDate = today;

  console.log(`[Instruments] Loaded ${instruments.length} NSE instruments`);
  return instruments;
}

function parseInstruments(csv: string): Instrument[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const tokenIdx = headers.indexOf('instrument_token');
  const exchangeTokenIdx = headers.indexOf('exchange_token');
  const symbolIdx = headers.indexOf('tradingsymbol');
  const nameIdx = headers.indexOf('name');
  const exchangeIdx = headers.indexOf('exchange');
  const typeIdx = headers.indexOf('instrument_type');

  const instruments: Instrument[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < headers.length) continue;

    // Only include equities (EQ) — skip futures, options, indices
    const type = cols[typeIdx]?.trim();
    if (type !== 'EQ') continue;

    const tradingsymbol = cols[symbolIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    if (!tradingsymbol) continue;

    instruments.push({
      instrumentToken: parseInt(cols[tokenIdx], 10),
      exchangeToken: parseInt(cols[exchangeTokenIdx], 10),
      tradingsymbol,
      name: name || tradingsymbol,
      exchange: cols[exchangeIdx]?.trim() || 'NSE',
    });
  }

  return instruments;
}

/**
 * Prefix-match search across tradingsymbol and company name.
 * Returns up to `limit` matches sorted by symbol length (shorter = more relevant).
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

  // Sort: exact prefix on symbol first, then by symbol length (shorter = better match)
  matches.sort((a, b) => {
    const aPrefix = a.tradingsymbol.toUpperCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.tradingsymbol.toUpperCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.tradingsymbol.length - b.tradingsymbol.length;
  });

  return matches.slice(0, limit);
}
