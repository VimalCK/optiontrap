/**
 * Instruments Service — shared instrument cache with a cross-process fetch lock.
 *
 * Fetches two datasets from Kite:
 *   1. NSE instruments (filtered to EQ — stocks only)
 *   2. NFO instruments (filtered to NIFTY CE/PE/FUT only)
 *
 * Ensures only ONE fetch cycle happens per day, regardless of how many
 * concurrent users (or app replicas) request instruments simultaneously.
 * A cross-process Postgres advisory lock serializes the fetch; late callers
 * find the freshly-cached data and skip the Kite call.
 */

import { getInstrumentsDate, getInstruments, saveInstruments, withAdvisoryLock } from './db.js';

// Arbitrary constant identifying the instruments-fetch advisory lock.
const INSTRUMENTS_FETCH_LOCK = 573210;

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
 * Strip surrounding double-quotes from a CSV field value.
 */
function unquote(val) {
  if (val && val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1);
  }
  return val;
}

/**
 * Parse a Kite instruments CSV and return matching rows based on a filter.
 *
 * @param {string} csv - Raw CSV text
 * @param {(cols: string[], indices: Record<string, number>) => object | null} rowFilter
 *   Called for each data row. Return an instrument object to include it, or null to skip.
 */
/**
 * Split a CSV line respecting quoted fields (handles commas inside quotes).
 */
function splitCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

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
    const cols = splitCSVLine(lines[i]);
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
 * Filter for NFO CSV — all F&O options (CE/PE) and futures (FUT).
 */
function nfoFilter(cols, idx) {
  const type = cols[idx.instrument_type]?.trim();
  if (type !== 'CE' && type !== 'PE' && type !== 'FUT') return null;

  const name = cols[idx.name]?.trim();
  if (!name) return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  if (!tradingsymbol) return null;

  const strike = parseFloat(cols[idx.strike]) || null;
  const expiry = cols[idx.expiry]?.trim() || null;
  const lotSize = parseInt(cols[idx.lot_size], 10) || null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken: parseInt(cols[idx.exchange_token], 10) || 0,
    tradingsymbol,
    name,
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
  const lines = csv.trim().split('\n');
  console.log(`[Instruments] ${url} — ${lines.length} rows, headers: ${lines[0]}`);
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

  console.log(`[Instruments] Parsed: ${nse.length} NSE stocks, ${nfo.length} NFO F&O`);

  // Log unique NFO names for debugging
  const nfoNames = new Set(nfo.map((i) => i.name));
  console.log(`[Instruments] NFO unique names (${nfoNames.size}): ${[...nfoNames].slice(0, 20).join(', ')}${nfoNames.size > 20 ? '...' : ''}`);

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
 * Get instruments — from the database cache or Kite API.
 *
 * A cross-process advisory lock ensures only one fetch happens per day even
 * across multiple app replicas; concurrent callers block on the lock and then
 * read the freshly-cached rows instead of calling Kite again.
 *
 * @param {string} apiKey - Caller's API key (used only if fetch is needed)
 * @param {string} accessToken - Caller's access token
 * @returns {Promise<any[]>} Array of instrument objects
 */
export async function getOrFetchInstruments(apiKey, accessToken) {
  const today = getTodayIST();

  // 1. Fast path — return today's cache without locking.
  const cachedDate = await getInstrumentsDate();
  if (cachedDate === today) {
    const cached = await getInstruments();
    if (cached.length > 0) return cached;
  }

  // 2. Serialize the fetch across all callers/replicas.
  return withAdvisoryLock(INSTRUMENTS_FETCH_LOCK, async () => {
    // Re-check inside the lock — another caller may have just fetched.
    const recheckDate = await getInstrumentsDate();
    if (recheckDate === today) {
      const cached = await getInstruments();
      if (cached.length > 0) return cached;
    }

    console.log('[Instruments] Fetching NSE + NFO instruments from Kite...');
    const instruments = await fetchFromKite(apiKey, accessToken);
    await saveInstruments(instruments, today);
    console.log(`[Instruments] Cached ${instruments.length} instruments (NSE EQ + NFO F&O) for ${today}`);
    return instruments;
  });
}
