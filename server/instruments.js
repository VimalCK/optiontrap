/**
 * Instruments Service — shared instrument cache with a cross-process fetch lock.
 *
 * Fetches three datasets from Kite:
 *   1. NSE instruments (EQ: stocks, ETFs and indices)
 *   2. NFO instruments (all CE/PE/FUT)
 *   3. BSE stocks that aren't listed on NSE, so no stock appears twice
 *
 * Ensures only ONE fetch cycle happens per day, regardless of how many
 * concurrent users (or app replicas) request instruments simultaneously.
 * A cross-process Postgres advisory lock serializes the fetch; late callers
 * find the freshly-cached data and skip the Kite call.
 */

import { getInstrumentsDate, getInstruments, saveInstruments, withAdvisoryLock } from './db.js';

// Arbitrary constant identifying the instruments-fetch advisory lock.
const INSTRUMENTS_FETCH_LOCK = 573210;

// Stored with the fetch date; bump it when the instrument mix changes so the
// day's cache is refetched instead of served until tomorrow.
const CACHE_VERSION = 'v4-bse-scrip-code';
const cacheStamp = (date) => `${date}|${CACHE_VERSION}`;

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

// NSE trading series of government securities, T-bills and sovereign gold bonds.
const NSE_DEBT_SERIES = new Set(['SG', 'GS', 'TB', 'GB']);

/**
 * Kite lists bonds, T-bills, gold bonds and mutual fund units as EQ alongside
 * stocks. Tell them apart from stocks, ETFs, REITs/InvITs and indices: NSE by
 * the series suffix, BSE by the scrip code (exchangeToken), whose equity range
 * is 500000–599999 — bonds, gold bonds and commercial paper sit at 7xxxxx–9xxxxx.
 */
export function isDebtOrFund({ exchange, exchangeToken, tradingsymbol, name }) {
  // Corporate bonds, iNAVs and fund schemes carry no company name.
  if (!name) return true;
  // "SDL KA 6.56% 2030", "2.50%GOLDBONDS2028SR-VI", "7.95% GOI 2032"
  if (name.includes('%') || /MUTUAL FUND/i.test(name)) return true;
  if (exchange === 'NSE') return NSE_DEBT_SERIES.has(tradingsymbol.match(/-([A-Z0-9]+)$/)?.[1]);
  return exchangeToken < 500000 || exchangeToken > 599999;
}

/**
 * Filter for NSE CSV — EQ rows: stocks, ETFs and indices, without debt and fund units.
 */
function nseFilter(cols, idx) {
  const type = cols[idx.instrument_type]?.trim();
  if (type !== 'EQ') return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  const name = cols[idx.name]?.trim();
  if (!tradingsymbol || isDebtOrFund({ exchange: 'NSE', tradingsymbol, name })) return null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken: parseInt(cols[idx.exchange_token], 10) || 0,
    tradingsymbol,
    name,
    exchange: 'NSE',
    instrumentType: 'EQ',
    strike: null,
    expiry: null,
    lotSize: null,
  };
}

/**
 * Filter for BSE CSV — stocks and ETFs. Indices, debt and fund units are skipped.
 */
function bseFilter(cols, idx) {
  if (cols[idx.instrument_type]?.trim() !== 'EQ' || cols[idx.segment]?.trim() !== 'BSE') return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  const name = cols[idx.name]?.trim();
  const exchangeToken = parseInt(cols[idx.exchange_token], 10) || 0;
  if (!tradingsymbol || isDebtOrFund({ exchange: 'BSE', exchangeToken, tradingsymbol, name })) return null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken,
    tradingsymbol,
    name,
    exchange: 'BSE',
    instrumentType: 'EQ',
    strike: null,
    expiry: null,
    lotSize: null,
  };
}

/** NSE marks a stock's trading series with a suffix (`-BE`, `-SM`) and BSE its group (`-B`); compare without it. */
const baseSymbol = (symbol) => symbol.replace(/-[A-Z0-9]{1,2}$/, '');

/** Company name without punctuation or a trailing (possibly truncated) "Limited". */
const companyKey = (name) => name.toUpperCase()
  .replace(/\b(LIMITED|LIMITE|LIMIT|LIMI|LIM|LTD|LI|L)\b\.?\s*$/, '')
  .replace(/[^A-Z0-9]/g, '');

/**
 * The BSE stocks not also listed on NSE. Kite's lists carry no ISIN, so a BSE
 * stock counts as listed on NSE when its symbol or company name matches an NSE stock.
 */
export function bseOnlyStocks(nseStocks, bseStocks) {
  const nseSymbols = new Set(nseStocks.flatMap((s) => [s.tradingsymbol, baseSymbol(s.tradingsymbol)]));
  const nseCompanies = new Set(nseStocks.map((s) => companyKey(s.name)).filter(Boolean));
  return bseStocks.filter((s) => !nseSymbols.has(s.tradingsymbol)
    && !nseSymbols.has(baseSymbol(s.tradingsymbol))
    && !nseCompanies.has(companyKey(s.name)));
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
 * Fetch NSE, NFO and BSE instruments in parallel.
 */
async function fetchFromKite(apiKey, accessToken) {
  const [nse, nfo, bse] = await Promise.all([
    fetchAndParse('https://api.kite.trade/instruments/NSE', nseFilter, apiKey, accessToken),
    fetchAndParse('https://api.kite.trade/instruments/NFO', nfoFilter, apiKey, accessToken),
    fetchAndParse('https://api.kite.trade/instruments/BSE', bseFilter, apiKey, accessToken),
  ]);
  const bseOnly = bseOnlyStocks(nse, bse);

  console.log(`[Instruments] Parsed: ${nse.length} NSE stocks, ${nfo.length} NFO F&O, ${bseOnly.length} BSE-only stocks (of ${bse.length})`);

  // Log unique NFO names for debugging
  const nfoNames = new Set(nfo.map((i) => i.name));
  console.log(`[Instruments] NFO unique names (${nfoNames.size}): ${[...nfoNames].slice(0, 20).join(', ')}${nfoNames.size > 20 ? '...' : ''}`);

  const combined = [...nse, ...nfo, ...bseOnly];

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
  if (cachedDate === cacheStamp(today)) {
    const cached = await getInstruments();
    if (cached.length > 0) return cached;
  }

  // 2. Within this process, concurrent callers share one in-flight load rather
  //    than each holding a pooled connection while blocked on the advisory lock.
  if (!inFlightLoad || inFlightLoad.date !== today) {
    const promise = loadWithLock(apiKey, accessToken, today)
      .finally(() => { if (inFlightLoad?.promise === promise) inFlightLoad = null; });
    inFlightLoad = { date: today, promise };
  }
  return inFlightLoad.promise;
}

/** @type {{ date: string, promise: Promise<any[]> } | null} */
let inFlightLoad = null;

async function loadWithLock(apiKey, accessToken, today) {
  // 3. Serialize the fetch across replicas.
  return withAdvisoryLock(INSTRUMENTS_FETCH_LOCK, async () => {
    // Re-check inside the lock — another caller may have just fetched.
    const recheckDate = await getInstrumentsDate();
    if (recheckDate === cacheStamp(today)) {
      const cached = await getInstruments();
      if (cached.length > 0) return cached;
    }

    console.log('[Instruments] Fetching NSE + NFO + BSE instruments from Kite...');
    const instruments = await fetchFromKite(apiKey, accessToken);
    await saveInstruments(instruments, cacheStamp(today));
    console.log(`[Instruments] Cached ${instruments.length} instruments (NSE EQ + NFO F&O + BSE-only EQ) for ${today}`);
    return instruments;
  });
}
