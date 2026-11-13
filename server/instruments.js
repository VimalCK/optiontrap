/**
 * Shared instrument cache. A cross-process Postgres advisory lock allows one Kite fetch per published list, across
 * users and app replicas; late callers read the freshly saved rows.
 */

import { getInstrumentsDate, getInstruments, saveInstruments, withAdvisoryLock } from './db.js';
import { currentInstrumentListStart } from './tradeEngine/market.js';
import { kiteClient } from './kiteClient.js';
import { Exchange, InstrumentType, OptionType } from '../shared/tradeEnums.js';

const INSTRUMENTS_FETCH_LOCK = 573210;

// Stored with the load time; bump it when the instrument mix changes so the
// stored list is refetched instead of served until the next refresh.
const CACHE_VERSION = 'v4-bse-scrip-code';

/**
 * @param {string} csv - Raw CSV text
 * @param {(cols: string[], indices: Record<string, number>) => object | null} rowFilter
 *   Called for each data row. Return an instrument object to include it, or null to skip.
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
 * Kite lists bonds, T-bills, gold bonds and mutual fund units as EQ alongside stocks. NSE is told apart by the
 * series suffix; BSE by the scrip code, whose equity range is 500000–599999 (bonds sit at 7xxxxx–9xxxxx).
 */
export function isDebtOrFund({ exchange, exchangeToken, tradingsymbol, name }) {
  // Corporate bonds, iNAVs and fund schemes carry no company name.
  if (!name) return true;
  // "SDL KA 6.56% 2030", "2.50%GOLDBONDS2028SR-VI", "7.95% GOI 2032"
  if (name.includes('%') || /MUTUAL FUND/i.test(name)) return true;
  if (exchange === Exchange.NSE) return NSE_DEBT_SERIES.has(tradingsymbol.match(/-([A-Z0-9]+)$/)?.[1]);
  return exchangeToken < 500000 || exchangeToken > 599999;
}

function nseFilter(cols, idx) {
  const type = cols[idx.instrument_type]?.trim();
  if (type !== InstrumentType.EQ) return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  const name = cols[idx.name]?.trim();
  if (!tradingsymbol || isDebtOrFund({ exchange: Exchange.NSE, tradingsymbol, name })) return null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken: parseInt(cols[idx.exchange_token], 10) || 0,
    tradingsymbol,
    name,
    exchange: Exchange.NSE,
    instrumentType: InstrumentType.EQ,
    strike: null,
    expiry: null,
    lotSize: null,
  };
}

function bseFilter(cols, idx) {
  if (cols[idx.instrument_type]?.trim() !== InstrumentType.EQ || cols[idx.segment]?.trim() !== Exchange.BSE) return null;

  const tradingsymbol = cols[idx.tradingsymbol]?.trim();
  const name = cols[idx.name]?.trim();
  const exchangeToken = parseInt(cols[idx.exchange_token], 10) || 0;
  if (!tradingsymbol || isDebtOrFund({ exchange: Exchange.BSE, exchangeToken, tradingsymbol, name })) return null;

  return {
    instrumentToken: parseInt(cols[idx.instrument_token], 10),
    exchangeToken,
    tradingsymbol,
    name,
    exchange: Exchange.BSE,
    instrumentType: InstrumentType.EQ,
    strike: null,
    expiry: null,
    lotSize: null,
  };
}

/** NSE marks a stock's trading series with a suffix (`-BE`, `-SM`) and BSE its group (`-B`); compare without it. */
const baseSymbol = (symbol) => symbol.replace(/-[A-Z0-9]{1,2}$/, '');

const companyKey = (name) => name.toUpperCase()
  .replace(/\b(LIMITED|LIMITE|LIMIT|LIMI|LIM|LTD|LI|L)\b\.?\s*$/, '')
  .replace(/[^A-Z0-9]/g, '');

/** Kite's lists carry no ISIN, so a BSE stock counts as listed on NSE when its symbol or company name matches. */
export function bseOnlyStocks(nseStocks, bseStocks) {
  const nseSymbols = new Set(nseStocks.flatMap((s) => [s.tradingsymbol, baseSymbol(s.tradingsymbol)]));
  const nseCompanies = new Set(nseStocks.map((s) => companyKey(s.name)).filter(Boolean));
  return bseStocks.filter((s) => !nseSymbols.has(s.tradingsymbol)
    && !nseSymbols.has(baseSymbol(s.tradingsymbol))
    && !nseCompanies.has(companyKey(s.name)));
}

function nfoFilter(cols, idx) {
  const type = cols[idx.instrument_type]?.trim();
  if (type !== OptionType.CE && type !== OptionType.PE && type !== InstrumentType.FUT) return null;

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
    exchange: Exchange.NFO,
    instrumentType: type,
    strike,
    expiry,
    lotSize,
  };
}

async function fetchAndParse(exchange, filter, apiKey, accessToken) {
  const path = `/instruments/${exchange}`;
  const csv = await kiteClient({ apiKey, accessToken }).getText(path);
  const lines = csv.trim().split('\n');
  console.log(`[Instruments] ${path} — ${lines.length} rows, headers: ${lines[0]}`);
  return parseCSV(csv, filter);
}

async function fetchFromKite(apiKey, accessToken) {
  const [nse, nfo, bse] = await Promise.all([
    fetchAndParse(Exchange.NSE, nseFilter, apiKey, accessToken),
    fetchAndParse(Exchange.NFO, nfoFilter, apiKey, accessToken),
    fetchAndParse(Exchange.BSE, bseFilter, apiKey, accessToken),
  ]);
  const bseOnly = bseOnlyStocks(nse, bse);

  console.log(`[Instruments] Parsed: ${nse.length} NSE stocks, ${nfo.length} NFO F&O, ${bseOnly.length} BSE-only stocks (of ${bse.length})`);

  const nfoNames = new Set(nfo.map((i) => i.name));
  console.log(`[Instruments] NFO unique names (${nfoNames.size}): ${[...nfoNames].slice(0, 20).join(', ')}${nfoNames.size > 20 ? '...' : ''}`);

  const combined = [...nse, ...nfo, ...bseOnly];

  if (combined.length === 0) {
    throw new Error('Parsed 0 instruments from Kite — likely a format change');
  }

  return combined;
}

/**
 * Whether a stored load stamp (`<ISO load time>|<CACHE_VERSION>`) is current. Older date-only stamps parse as
 * midnight UTC and so count as stale.
 */
export function isInstrumentStampFresh(stamp, now = new Date()) {
  if (!stamp) return false;
  const [loadedAt, version] = String(stamp).split('|');
  const loadedMs = Date.parse(loadedAt);
  return version === CACHE_VERSION && !Number.isNaN(loadedMs) && loadedMs >= currentInstrumentListStart(now);
}

/** Whether the instruments table holds the current list (see isInstrumentStampFresh). */
export async function instrumentsAreFresh() {
  return isInstrumentStampFresh(await getInstrumentsDate());
}

/**
 * The table is refreshed once per published list (from 08:30 IST each day).
 *
 * @param {string} apiKey - Caller's API key (used only if fetch is needed)
 * @param {string} accessToken - Caller's access token
 * @returns {Promise<any[]>} Array of instrument objects
 */
export async function getOrFetchInstruments(apiKey, accessToken) {
  if (await instrumentsAreFresh()) {
    const cached = await getInstruments();
    if (cached.length > 0) return cached;
  }

  // Concurrent callers in this process share one load, so none holds a pooled connection while blocked on the lock.
  const listStart = currentInstrumentListStart();
  if (!inFlightLoad || inFlightLoad.listStart !== listStart) {
    const promise = loadWithLock(apiKey, accessToken)
      .finally(() => { if (inFlightLoad?.promise === promise) inFlightLoad = null; });
    inFlightLoad = { listStart, promise };
  }
  return inFlightLoad.promise;
}

/** @type {{ listStart: number, promise: Promise<any[]> } | null} */
let inFlightLoad = null;

async function loadWithLock(apiKey, accessToken) {
  return withAdvisoryLock(INSTRUMENTS_FETCH_LOCK, async () => {
    if (await instrumentsAreFresh()) {
      const cached = await getInstruments();
      if (cached.length > 0) return cached;
    }

    console.log('[Instruments] Fetching NSE + NFO + BSE instruments from Kite...');
    const instruments = await fetchFromKite(apiKey, accessToken);
    const summary = await saveInstruments(instruments, `${new Date().toISOString()}|${CACHE_VERSION}`);
    console.log(`[Instruments] Synced ${instruments.length} instruments: ${summary.added} added, ${summary.updated} updated, ${summary.removed} removed`);
    return instruments;
  });
}
