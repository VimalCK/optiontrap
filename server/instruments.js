/**
 * Instruments Service — shared NSE equity instrument cache with fetch mutex.
 *
 * Ensures only ONE Kite API call happens per day, regardless of how many
 * concurrent users request instruments simultaneously. The first request
 * triggers the fetch; all others await the same in-flight promise.
 *
 * Flow:
 *   1. Check SQLite for today's instruments (IST date match)
 *   2. If cached → return immediately
 *   3. If not cached → acquire mutex (in-flight promise) → fetch from Kite
 *   4. Parse CSV → save to SQLite → release mutex → return
 *   5. Concurrent callers that arrive while fetch is in-flight await step 3's promise
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

/**
 * Parse Kite's instruments CSV into equity-only instrument objects.
 */
function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const tokenIdx = headers.indexOf('instrument_token');
  const exchangeTokenIdx = headers.indexOf('exchange_token');
  const symbolIdx = headers.indexOf('tradingsymbol');
  const nameIdx = headers.indexOf('name');
  const exchangeIdx = headers.indexOf('exchange');
  const typeIdx = headers.indexOf('instrument_type');

  if (tokenIdx < 0 || symbolIdx < 0 || typeIdx < 0) return [];

  const instruments = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < headers.length) continue;

    const type = cols[typeIdx]?.trim();
    if (type !== 'EQ') continue;

    const tradingsymbol = cols[symbolIdx]?.trim();
    if (!tradingsymbol) continue;

    instruments.push({
      instrumentToken: parseInt(cols[tokenIdx], 10),
      exchangeToken: parseInt(cols[exchangeTokenIdx], 10) || 0,
      tradingsymbol,
      name: (cols[nameIdx]?.trim()) || tradingsymbol,
      exchange: (cols[exchangeIdx]?.trim()) || 'NSE',
    });
  }

  return instruments;
}

/**
 * Fetch instruments from Kite API using the requesting user's credentials.
 * Only called when the mutex is free and cache is stale.
 *
 * @param {string} apiKey - User's API key (from session)
 * @param {string} accessToken - User's access token (from session)
 */
async function fetchFromKite(apiKey, accessToken) {
  const url = 'https://api.kite.trade/instruments/NSE';
  const res = await fetch(url, {
    headers: { Authorization: `token ${apiKey}:${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Kite instruments fetch failed: ${res.status} ${res.statusText}`);
  }

  const csv = await res.text();
  const instruments = parseCSV(csv);

  if (instruments.length === 0) {
    throw new Error('Parsed 0 instruments from Kite CSV — likely a format change');
  }

  return instruments;
}

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

      console.log('[Instruments] Fetching fresh NSE instruments from Kite...');
      const instruments = await fetchFromKite(apiKey, accessToken);
      saveInstruments(instruments, today);
      console.log(`[Instruments] Cached ${instruments.length} instruments for ${today}`);
      return instruments;
    } finally {
      // Release mutex — next caller with stale cache will re-fetch
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}
