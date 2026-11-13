/**
 * Every 10 minutes in market hours (09:15–15:30 IST, trading days), quotes the nearest-expiry chain around ATM for the
 * always_snapshot underlyings and any symbol opened in the Option Analyzer today, and stores one shared snapshot row.
 * Each snapshot's `contracts` say what every token is, so an exported snapshot can be analysed on its own.
 */

import { getAlwaysSnapshotSymbols, getTodayOiSnapshotTokens, getUnderlyings, saveOiSnapshot } from './db.js';
import { getOrFetchInstruments } from './instruments.js';
import { istClock, isMarketOpen } from './marketClock.js';
import { marketDateTime, marketTimeLabel } from '../shared/marketTime.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';
import { fetchQuotes } from './kiteQuotes.js';
import { KiteApiError } from './kiteClient.js';
import { Exchange, isOptionType } from '../shared/tradeEnums.js';
import { SnapshotContractType } from '../shared/analysisEnums.js';

/** Strikes each side of ATM. The analyzer shows ±15; the extra covers ATM drifting during the day. */
const STRIKES_EACH_SIDE = 20;
export const OI_SNAPSHOT_JOB_ID = 'oi-snapshots';
const SLOT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

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

/** Kite's quote time ('YYYY-MM-DD HH:MM:SS', market time) in epoch ms, or null. */
export function kiteQuoteTimeMs(value) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [, date, h, m, s] = match;
  return marketDateTime(date).getTime() + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
}

/** What an option's token is, for the snapshot's `contracts` map. */
const optionContract = (option) => ({
  symbol: option.tradingsymbol,
  underlying: option.name,
  type: option.instrumentType,
  strike: option.strike,
  expiry: option.expiry ? option.expiry.slice(0, 10) : null,
});

/** What an underlying's price token is, for the snapshot's `contracts` map. */
const spotContract = (underlying, symbol) => ({ symbol, underlying, type: SnapshotContractType.SPOT });

function optionsByUnderlying(instruments) {
  const byName = new Map();
  for (const i of instruments) {
    if (i.exchange !== Exchange.NFO || !isOptionType(i.instrumentType)) continue;
    if (!byName.has(i.name)) byName.set(i.name, []);
    byName.get(i.name).push(i);
  }
  return byName;
}

/**
 * Underlyings with options in today's snapshots. A stock opened in the
 * analyzer gets its first snapshot at once, so this is today's watch list;
 * tomorrow has no snapshots yet, so it starts empty again.
 */
async function snapshottedToday(instruments) {
  const tokens = new Set(await getTodayOiSnapshotTokens());
  const names = new Set();
  for (const i of instruments) {
    if (i.exchange === Exchange.NFO && tokens.has(String(i.instrumentToken))) names.add(i.name);
  }
  return names;
}

/**
 * Each symbol's spot price goes in `prices` (and `close`) under its price instrument's token. Options also get their
 * best bid/ask and last trade time, so a stale last price can be told apart.
 */
async function captureSymbols(symbols, kite, instruments, now = new Date()) {
  const { date } = istClock(now);
  const options = optionsByUnderlying(instruments);
  const spotRows = new Map((await getUnderlyings())
    .filter((u) => symbols.includes(u.name) && u.instrumentToken !== null)
    .map((u) => [u.name, { token: String(u.instrumentToken), key: `${u.exchange}:${u.tradingsymbol}`, symbol: u.tradingsymbol }]));

  const spotQuotes = await fetchQuotes(kite, [...spotRows.values()].map((row) => row.key));
  const spotOf = (symbol) => spotQuotes[spotRows.get(symbol)?.key]?.last_price || 0;
  const chain = symbols.flatMap((s) => pickChainWindow(options.get(s) || [], spotOf(s), date));
  if (chain.length === 0) return 0;

  const quotes = await fetchQuotes(kite, chain.map((o) => `NFO:${o.tradingsymbol}`));
  const data = {};
  const prices = {};
  const close = {};
  const volumes = {};
  const bids = {};
  const asks = {};
  const tradeTimes = {};
  const contracts = {};
  for (const [underlying, { token, key, symbol }] of spotRows) {
    const q = spotQuotes[key];
    if (!q) continue;
    contracts[token] = spotContract(underlying, symbol);
    if (q.last_price > 0) prices[token] = q.last_price;
    if (q.ohlc?.close > 0) close[token] = q.ohlc.close;
  }
  for (const o of chain) {
    const q = quotes[`NFO:${o.tradingsymbol}`];
    if (!q) continue;
    const token = String(o.instrumentToken);
    contracts[token] = optionContract(o);
    if (q.oi > 0) data[token] = q.oi;
    if (q.last_price > 0) prices[token] = q.last_price;
    if (q.ohlc?.close > 0) close[token] = q.ohlc.close;
    if (q.volume > 0) volumes[token] = q.volume;
    const bid = q.depth?.buy?.[0]?.price;
    const ask = q.depth?.sell?.[0]?.price;
    if (bid > 0) bids[token] = bid;
    if (ask > 0) asks[token] = ask;
    const tradeTime = kiteQuoteTimeMs(q.last_trade_time);
    if (tradeTime !== null) tradeTimes[token] = tradeTime;
  }
  if (Object.keys(data).length === 0) return 0;

  await saveOiSnapshot({ timestamp: now.getTime(), timeLabel: marketTimeLabel(now), data, prices, close, volumes, bids, asks, tradeTimes, contracts });
  return Object.keys(data).length;
}

/** Drops the cached session if Kite rejects it. */
function capture(date, pickSymbols) {
  return enqueue(async () => {
    const kite = await getAdminKite(date);
    if (!kite) return { symbols: [], count: 0, kite: null, instruments: [] };
    try {
      const instruments = await getOrFetchInstruments(kite.apiKey, kite.accessToken);
      const symbols = await pickSymbols(instruments);
      const count = symbols.length > 0 ? await captureSymbols(symbols, kite, instruments) : 0;
      return { symbols, count, kite, instruments };
    } catch (err) {
      if (err instanceof KiteApiError && err.authFailure) adminKite = null;
      throw err;
    }
  });
}

/**
 * Snapshot `symbol` for the rest of today. If it isn't already in today's
 * snapshots and the market is open, take its first snapshot now: the
 * analyzer gets data at once, and later rounds see it and keep capturing it.
 */
export async function watchOiSnapshotSymbol(symbol) {
  if (!isMarketOpen() || (await getAlwaysSnapshotSymbols()).includes(symbol)) return { captured: 0 };
  const { date } = istClock();
  const { count } = await capture(date, async (instruments) => (
    (await snapshottedToday(instruments)).has(symbol) ? [] : [symbol]
  ));
  if (count > 0) console.log(`[OI Snapshots] Now snapshotting ${symbol} for today (${count} options)`);
  return { captured: count };
}

async function captureSlot() {
  const slot = Math.floor(Date.now() / SLOT_MS);
  if (slot === lastSlot) return;

  const { date } = istClock();
  const { symbols, count } = await capture(date, async (list) => (
    [...new Set([...(await getAlwaysSnapshotSymbols()), ...(await snapshottedToday(list))])]
  ));
  if (count > 0) {
    lastSlot = slot;
    console.log(`[OI Snapshots] Saved ${count} options for ${symbols.join(', ')}`);
  }
}

export const oiSnapshotJob = {
  id: OI_SNAPSHOT_JOB_ID,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.every(CHECK_INTERVAL_MS, captureSlot);
  },
};
