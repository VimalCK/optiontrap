/**
 * Server-side OI snapshot behaviour, end to end through the module's public
 * functions, with Kite, the database and the clock faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  watched: new Map(), // date -> Set(symbol)
  saves: [],          // saveOiSnapshot arguments, in order
  admin: { apiKey: 'key', accessToken: 'token', userId: 'ADMIN' },
}));

vi.mock('./db.js', () => ({
  addOiSnapshotSymbol: async (date, symbol) => {
    const set = state.watched.get(date) || new Set();
    state.watched.set(date, set);
    if (set.has(symbol)) return false;
    set.add(symbol);
    return true;
  },
  getOiSnapshotSymbols: async (date) => [...(state.watched.get(date) || [])],
  saveOiSnapshot: async (snapshot) => { state.saves.push(snapshot); },
}));

vi.mock('./oiHistoryScheduler.js', () => ({
  findWorkingAdminSession: async () => state.admin,
}));

// Five strikes per underlying, CE and PE, one expiry after the test dates.
const UNDERLYINGS = { NIFTY: 24000, BANKNIFTY: 52000, RELIANCE: 1400, HDFCBANK: 1700 };
const SPOT_KEYS = { NIFTY: 'NSE:NIFTY 50', BANKNIFTY: 'NSE:NIFTY BANK', RELIANCE: 'NSE:RELIANCE', HDFCBANK: 'NSE:HDFCBANK' };
const tokenSymbol = new Map();
const INSTRUMENTS = Object.entries(UNDERLYINGS).flatMap(([name, spot], u) => [-2, -1, 0, 1, 2].flatMap((step, s) =>
  ['CE', 'PE'].map((type, t) => {
    const instrumentToken = 1000 * (u + 1) + 10 * s + t;
    tokenSymbol.set(String(instrumentToken), name);
    const strike = spot + step * 100;
    return { exchange: 'NFO', name, instrumentType: type, instrumentToken, tradingsymbol: `${name}${strike}${type}`, strike, expiry: '2026-11-24' };
  })));

vi.mock('./instruments.js', () => ({ getOrFetchInstruments: async () => INSTRUMENTS }));

/** Kite /quote: spot keys get a price; option keys get OI, price, volume and close. */
async function fakeKiteFetch(url) {
  const keys = new URL(url).searchParams.getAll('i');
  const data = {};
  for (const key of keys) {
    const spotOf = Object.keys(SPOT_KEYS).find((name) => SPOT_KEYS[name] === key);
    data[key] = spotOf
      ? { last_price: UNDERLYINGS[spotOf] }
      : { oi: 5000, last_price: 100, volume: 200, ohlc: { close: 90 } };
  }
  return { ok: true, status: 200, json: async () => ({ data }) };
}

/** Underlyings whose options are in a saved snapshot. */
const symbolsIn = (snapshot) => [...new Set(Object.keys(snapshot.data).map((t) => tokenSymbol.get(t)))].sort();

// IST is UTC+05:30. Tue 3 Nov 2026 is a trading day.
const ist = (hhmm, date = '2026-11-03') => new Date(`${date}T${hhmm}:00+05:30`);

let scheduler;

beforeEach(async () => {
  state.watched.clear();
  state.saves.length = 0;
  state.admin = { apiKey: 'key', accessToken: 'token', userId: 'ADMIN' };
  vi.useFakeTimers({ now: ist('10:02') });
  vi.stubGlobal('fetch', vi.fn(fakeKiteFetch));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.resetModules(); // fresh scheduler state (cached session, last slot) per test
  scheduler = await import('./oiSnapshotScheduler.js');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Start the scheduler and let its first check finish. */
async function startScheduler() {
  scheduler.startOiSnapshotScheduler();
  await vi.advanceTimersByTimeAsync(0);
}

describe('picking a symbol in the Option Analyzer', () => {
  it('watches RELIANCE then HDFCBANK picked straight after, each with an immediate first snapshot', async () => {
    expect(await scheduler.watchOiSnapshotSymbol('RELIANCE')).toEqual({ added: true, captured: 10 });
    expect(await scheduler.watchOiSnapshotSymbol('HDFCBANK')).toEqual({ added: true, captured: 10 });

    expect([...state.watched.get('2026-11-03')]).toEqual(['RELIANCE', 'HDFCBANK']);
    expect(state.saves.map(symbolsIn)).toEqual([['RELIANCE'], ['HDFCBANK']]);
  });

  it('does not take an extra snapshot for NIFTY, BANKNIFTY or an already-watched stock', async () => {
    expect(await scheduler.watchOiSnapshotSymbol('NIFTY')).toEqual({ added: false, captured: 0 });
    expect(await scheduler.watchOiSnapshotSymbol('BANKNIFTY')).toEqual({ added: false, captured: 0 });
    await scheduler.watchOiSnapshotSymbol('RELIANCE');
    expect(await scheduler.watchOiSnapshotSymbol('RELIANCE')).toEqual({ added: false, captured: 0 });

    expect(state.saves).toHaveLength(1);
    expect(state.watched.get('2026-11-03')).toEqual(new Set(['RELIANCE']));
  });

  it('adds the symbol but takes no snapshot while the market is closed', async () => {
    vi.setSystemTime(ist('16:00'));
    expect(await scheduler.watchOiSnapshotSymbol('RELIANCE')).toEqual({ added: true, captured: 0 });
    expect(state.saves).toHaveLength(0);
  });
});

describe('the 10-minute rounds', () => {
  it('always snapshots NIFTY and BANKNIFTY, with no symbol picked', async () => {
    await startScheduler();

    expect(state.saves.map(symbolsIn)).toEqual([['BANKNIFTY', 'NIFTY']]);
    expect(state.saves[0]).toMatchObject({ timeLabel: '10:02', spot: 24000 });
  });

  it('keeps snapshotting a symbol after the user switches away from it', async () => {
    await startScheduler(); // 10:02 round: NIFTY, BANKNIFTY
    vi.setSystemTime(ist('10:05'));
    await scheduler.watchOiSnapshotSymbol('RELIANCE');
    await scheduler.watchOiSnapshotSymbol('HDFCBANK'); // switched straight away

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // to 10:10, the next round

    const round = state.saves.at(-1);
    expect(round.timeLabel).toBe('10:10');
    expect(symbolsIn(round)).toEqual(['BANKNIFTY', 'HDFCBANK', 'NIFTY', 'RELIANCE']);
  });

  it('captures once per 10-minute slot although it checks every minute', async () => {
    await startScheduler();                           // 10:02
    await vi.advanceTimersByTimeAsync(7 * 60 * 1000); // 10:09, same slot
    expect(state.saves).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);     // 10:10, new slot
    expect(state.saves).toHaveLength(2);
  });

  it('takes no snapshots outside market hours', async () => {
    vi.setSystemTime(ist('09:00'));
    await startScheduler();
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000); // to 09:14
    expect(state.saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60 * 1000);      // 09:15, market opens
    expect(state.saves).toHaveLength(1);
  });

  it('takes no snapshots on an exchange holiday', async () => {
    vi.setSystemTime(ist('11:00', '2026-11-10'));
    await startScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(state.saves).toHaveLength(0);
  });

  it('waits without an admin Kite session, then starts once one exists', async () => {
    state.admin = null;
    await startScheduler();
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000); // 10:05
    expect(state.saves).toHaveLength(0);

    state.admin = { apiKey: 'key', accessToken: 'token', userId: 'ADMIN' };
    await vi.advanceTimersByTimeAsync(60 * 1000);     // 10:06, admin has logged in
    expect(state.saves.map(symbolsIn)).toEqual([['BANKNIFTY', 'NIFTY']]);
  });
});
