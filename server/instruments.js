/**
 * Instruments Service — shared instrument cache with fetch mutex.
 *
 * Fetches two datasets from Kite:
 *   1. NSE instruments (filtered to EQ — stocks only)
 *   2. NFO instruments (filtered to NIFTY CE/PE/FUT only)
 *
 * Ensures only ONE fetch cycle happens per day, regardless of how many
 * concurrent users request instruments simultaneously. The first request
 * triggers the fetch; all others await the same in-flight promise.
 */

import { getInstrumentsDate, getInstruments, saveInstruments } from './db.js';

// ---------------------------------------------------------------------------
// Mutex — a single in-flight promise shared by all concurrent callers
// ---------------------------------------------------------------------------

/** @type {Promise<any[]> | null} */
let fetchInFlight = null;

/**
 * Get today's date in IST as YYYY-MM-DD.
 */
function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  const d = String(ist.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// CSV Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Kite instruments CSV and return matching rows based on a filter.
 *
 * @param {string} csv - Raw CSV text
 * @param {(cols: string[], indices: Record<string, number>) => object | null} rowFilter
 *   Called for each data row. Return an instrument object to include it, or null to skip.
 */
function parseCSV(csv, rowFilter) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const indices = {};
  for (let i = 0; i < headers.length; i++) {
    indices[headers[i]] = i;
  }

  if (!('instrument_token' in indices) || !('tradingsymbol' in indices)) return [];

  const instruments = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < headers.length) continue;

    const result = rowFilter(cols, indices);
    if (result) instruments.push(result);
  }

  return instruments;
}

/**
 * Filter for NSE CSV — only EQ (equity stocks).
 */
function nseFilter(cols, idx) {
  const type = cols[idx.instrument_type]?.trim();
  if (type !== 'EQ') return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  if (!tradingsymbol) return null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken: parseInt(cols[idx.exchange_token], 10) || 0,
    tradingsymbol,
    name: cols[idx.name]?.trim() || tradingsymbol,
    exchange: 'NSE',
    instrumentType: 'EQ',
    strike: null,
    expiry: null,
    lotSize: null,
  };
}

/**
 * Filter for NFO CSV — only NIFTY options (CE/PE) and futures (FUT).
 */
function nfoFilter(cols, idx) {
  const name = cols[idx.name]?.trim();
  if (name !== 'NIFTY') return null;

  const type = cols[idx.instrument_type]?.trim();
  if (type !== 'CE' && type !== 'PE' && type !== 'FUT') return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  if (!tradingsymbol) return null;

  const strike = parseFloat(cols[idx.strike]) || null;
  const expiry = cols[idx.expiry]?.trim() || null;
  const lotSize = parseInt(cols[idx.lot_size], 10) || null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken: parseInt(cols[idx.exchange_token], 10) || 0,
    tradingsymbol,
    name: 'NIFTY',
    exchange: 'NFO',
    instrumentType: type,
    strike,
    expiry,
    lotSize,
  };
}

// ---------------------------------------------------------------------------
// Kite API fetch
// ---------------------------------------------------------------------------

/**
 * Fetch and parse instruments from a Kite endpoint.
 */
async function fetchAndParse(url, filter, apiKey, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `token ${apiKey}:${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Kite fetch failed (${url}): ${res.status} ${res.statusText}`);
  }

  const csv = await res.text();
  return parseCSV(csv, filter);
}

/**
 * Fetch both NSE + NFO instruments in parallel.
 */
async function fetchFromKite(apiKey, accessToken) {
  const [nse, nfo] = await Promise.all([
    fetchAndParse('https://api.kite.trade/instruments/NSE', nseFilter, apiKey, accessToken),
    fetchAndParse('https://api.kite.trade/instruments/NFO', nfoFilter, apiKey, accessToken),
  ]);

  const combined = [...nse, ...nfo];

  if (combined.length === 0) {
    throw new Error('Parsed 0 instruments from Kite — likely a format change');
  }

  return combined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get instruments — from SQLite cache or Kite API (with mutex).
 *
 * @param {string} apiKey - Caller's API key (used only if fetch is needed)
 * @param {string} accessToken - Caller's access token
 * @returns {Promise<any[]>} Array of instrument objects
 */
export async function getOrFetchInstruments(apiKey, accessToken) {
  const today = getTodayIST();

  // 1. Check SQLite cache
  const cachedDate = getInstrumentsDate();
  if (cachedDate === today) {
    const cached = getInstruments();
    if (cached.length > 0) return cached;
  }

  // 2. If a fetch is already in-flight, await it (no duplicate API call)
  if (fetchInFlight) {
    return fetchInFlight;
  }

  // 3. Acquire mutex — this caller does the actual fetch
  fetchInFlight = (async () => {
    try {
      // Double-check after acquiring (another request may have just finished)
      const recheckDate = getInstrumentsDate();
      if (recheckDate === today) {
        const cached = getInstruments();
        if (cached.length > 0) return cached;
      }

      console.log('[Instruments] Fetching NSE + NFO instruments from Kite...');
      const instruments = await fetchFromKite(apiKey, accessToken);
      saveInstruments(instruments, today);
      console.log(`[Instruments] Cached ${instruments.length} instruments (NSE EQ + NIFTY F&O) for ${today}`);
      return instruments;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}
