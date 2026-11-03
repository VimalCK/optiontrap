/**
 * Intraday option-chain OI snapshots, taken by the server.
 *
 * Every 10 minutes while the market is open (09:15–15:30 IST, trading days),
 * quote the nearest-expiry option chain around ATM for NIFTY and BANKNIFTY,
 * plus any symbol someone opened in the Option Analyzer today, and store one
 * shared snapshot row. Nobody needs to keep the analyzer open.
 *
 * Uses the newest admin Kite session (see findWorkingAdminSession). With no
 * admin login today it waits and logs once.
 */

import { addOiSnapshotSymbol, getOiSnapshotSymbols, saveOiSnapshot } from './db.js';
import { getOrFetchInstruments } from './instruments.js';
import { istClock, isMarketOpen } from './marketClock.js';
import { marketTimeLabel } from '../shared/marketTime.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';

/** Always snapshotted, whether or not anyone opens them. */
export const ALWAYS_SNAPSHOT_SYMBOLS = ['NIFTY', 'BANKNIFTY'];

const INDEX_QUOTE_KEYS = { NIFTY: 'NSE:NIFTY 50', BANKNIFTY: 'NSE:NIFTY BANK' };
/** Strikes each side of ATM. The analyzer shows ±15; the extra covers ATM drifting during the day. */
const STRIKES_EACH_SIDE = 20;
const SLOT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const QUOTE_BATCH = 500; // Kite's limit per /quote request
class KiteAuthError extends Error {}

let adminKite = null; // { date, kite }
let lastSlot = null;
let lastWaitingLogDate = null;
// Captures run one at a time so the scheduled run and an on-demand run don't
// hit Kite's quote rate limit together.
let queue = Promise.resolve();

function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

function spotQuoteKey(symbol) {
  return INDEX_QUOTE_KEYS[symbol] || `NSE:${symbol}`;
}

/** Today's admin Kite session, cached for the day; null if none works. */
async function getAdminKite(date) {
  if (adminKite?.date === date) return adminKite.kite;
  const kite = await findWorkingAdminSession();
  adminKite = kite ? { date, kite } : null;
  if (!kite && lastWaitingLogDate !== date) {
    console.log('[OI Snapshots] Waiting for an admin Kite login today to take snapshots');
    lastWaitingLogDate = date;
  }
  return kite;
}

async function fetchQuotes(kite, keys) {
  const quotes = {};
  for (let i = 0; i < keys.length; i += QUOTE_BATCH) {
    const qs = keys.slice(i, i + QUOTE_BATCH).map((k) => `i=${encodeURIComponent(k)}`).join('&');
    const res = await fetch(`https://api.kite.trade/quote?${qs}`, {
      headers: { Authorization: `token ${kite.apiKey}:${kite.accessToken}`, 'X-Kite-Version': '3' },
    });
    if (res.status === 401 || res.status === 403) throw new KiteAuthError(`Kite quote auth failed (${res.status})`);
    if (!res.ok) throw new Error(`Kite quote failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    Object.assign(quotes, body.data || {});
  }
  return quotes;
}

/**
 * The options to snapshot for one underlying: its nearest expiry on or after
 * `today`, `each` strikes either side of the strike closest to `spot`. The
 * window shifts rather than shrinks near the edges of the chain.
 */
export function pickChainWindow(options, spot, today, each = STRIKES_EACH_SIDE) {
  const expiry = [...new Set(options.map((o) => o.expiry).filter((e) => e && e.slice(0, 10) >= today))].sort()[0];
  if (!expiry) return [];
  const forExpiry = options.filter((o) => o.expiry === expiry);
  const strikes = [...new Set(forExpiry.map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length === 0) return [];

  let atm = Math.floor(strikes.length / 2);
  if (spot > 0) {
    atm = 0;
    strikes.forEach((s, i) => { if (Math.abs(s - spot) < Math.abs(strikes[atm] - spot)) atm = i; });
  }
  const total = each * 2 + 1;
  let start = Math.max(0, atm - each);
  const end = Math.min(strikes.length, start + total);
  start = Math.max(0, end - total);
  const keep = new Set(strikes.slice(start, end));
  return forExpiry.filter((o) => keep.has(o.strike));
}

/** Quote the chains for `symbols` and store them in the current 10-minute snapshot row. */
async function captureSymbols(symbols, kite, now = new Date()) {
  const { date } = istClock(now);
  const instruments = await getOrFetchInstruments(kite.apiKey, kite.accessToken);

  const optionsBySymbol = new Map(symbols.map((s) => [s, []]));
  for (const i of instruments) {
    if (i.exchange === 'NFO' && (i.instrumentType === 'CE' || i.instrumentType === 'PE')) {
      optionsBySymbol.get(i.name)?.push(i);
    }
  }

  const spotQuotes = await fetchQuotes(kite, symbols.map(spotQuoteKey));
  const chain = symbols.flatMap((s) => pickChainWindow(optionsBySymbol.get(s), spotQuotes[spotQuoteKey(s)]?.last_price || 0, date));
  if (chain.length === 0) return 0;

  const quotes = await fetchQuotes(kite, chain.map((o) => `NFO:${o.tradingsymbol}`));
  const data = {};
  const prices = {};
  const close = {};
  const volumes = {};
  for (const o of chain) {
    const q = quotes[`NFO:${o.tradingsymbol}`];
    if (!q) continue;
    const token = String(o.instrumentToken);
    if (q.oi > 0) data[token] = q.oi;
    if (q.last_price > 0) prices[token] = q.last_price;
    if (q.ohlc?.close > 0) close[token] = q.ohlc.close;
    if (q.volume > 0) volumes[token] = q.volume;
  }
  if (Object.keys(data).length === 0) return 0;

  // The row has a single spot; it is NIFTY's, as the analyzer has always assumed.
  const spot = spotQuotes[spotQuoteKey('NIFTY')]?.last_price || undefined;
  await saveOiSnapshot({ timestamp: now.getTime(), timeLabel: marketTimeLabel(now), data, prices, close, volumes, spot });
  return Object.keys(data).length;
}

/** Capture with today's admin session, dropping the cached session if Kite rejects it. */
function capture(symbols, date) {
  return enqueue(async () => {
    const kite = await getAdminKite(date);
    if (!kite) return 0;
    try {
      return await captureSymbols(symbols, kite);
    } catch (err) {
      if (err instanceof KiteAuthError) adminKite = null;
      throw err;
    }
  });
}

/**
 * Snapshot `symbol` for the rest of today. If it's new to the list and the
 * market is open, take its first snapshot now so the analyzer has data at once.
 */
export async function watchOiSnapshotSymbol(symbol) {
  const { date } = istClock();
  if (ALWAYS_SNAPSHOT_SYMBOLS.includes(symbol)) return { added: false, captured: 0 };
  const added = await addOiSnapshotSymbol(date, symbol);
  if (!added || !isMarketOpen()) return { added, captured: 0 };
  const captured = await capture([symbol], date);
  console.log(`[OI Snapshots] Now snapshotting ${symbol} for today (${captured} options)`);
  return { added, captured };
}

async function tick() {
  if (!isMarketOpen()) return;
  const slot = Math.floor(Date.now() / SLOT_MS);
  if (slot === lastSlot) return;

  const { date } = istClock();
  const symbols = [...new Set([...ALWAYS_SNAPSHOT_SYMBOLS, ...(await getOiSnapshotSymbols(date))])];
  const count = await capture(symbols, date);
  if (count > 0) {
    lastSlot = slot;
    console.log(`[OI Snapshots] Saved ${count} options for ${symbols.join(', ')}`);
  }
}

/** Check every minute; snapshot once per 10-minute slot while the market is open. */
export function startOiSnapshotScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error('[OI Snapshots] Scheduled capture failed:', err.message);
    } finally {
      running = false;
    }
  };
  run();
  setInterval(run, CHECK_INTERVAL_MS).unref();
}
