/**
 * Server-side OI snapshot behaviour, end to end through the module's public
 * functions, with Kite, the database and the clock faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { marketDayStartMs } from '../shared/marketTime.js';

const state = vi.hoisted(() => ({
  saves: [], // saveOiSnapshot arguments, in order (the fake oi_snapshots table)
  always: [], // underlyings marked always_snapshot in Settings
  admin: { apiKey: 'key', accessToken: 'token', userId: 'ADMIN' },
}));

vi.mock('./db.js', () => ({
  getAlwaysSnapshotSymbols: async () => [...state.always],
  // Tokens in today's (market-day) snapshots, like the real query.
  getTodayOiSnapshotTokens: async () => [...new Set(state.saves
    .filter((snap) => snap.timestamp >= marketDayStartMs())
    .flatMap((snap) => Object.keys(snap.data)))],
  saveOiSnapshot: async (snapshot) => { state.saves.push(snapshot); },
  // Each underlying's price row, as in the instruments table.
  getUnderlyings: async () => Object.entries(SPOT_ROWS).map(([name, row]) => ({ name, ...row })),
}));

vi.mock('./oiHistoryScheduler.js', () => ({
  findWorkingAdminSession: async () => state.admin,
}));

// Five strikes per underlying, CE and PE, one expiry after the test dates.
const UNDERLYINGS = { NIFTY: 24000, BANKNIFTY: 52000, RELIANCE: 1400, HDFCBANK: 1700 };
const SPOT_ROWS = {
  NIFTY: { instrumentToken: 9001, exchange: 'NSE', tradingsymbol: 'NIFTY 50' },
  BANKNIFTY: { instrumentToken: 9002, exchange: 'NSE', tradingsymbol: 'NIFTY BANK' },
  RELIANCE: { instrumentToken: 9003, exchange: 'NSE', tradingsymbol: 'RELIANCE' },
  HDFCBANK: { instrumentToken: 9004, exchange: 'NSE', tradingsymbol: 'HDFCBANK' },
};
const SPOT_KEYS = Object.fromEntries(Object.entries(SPOT_ROWS).map(([name, row]) => [name, `${row.exchange}:${row.tradingsymbol}`]));
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
  state.saves.length = 0;
  state.always = ['NIFTY', 'BANKNIFTY'];
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
    expect(await scheduler.watchOiSnapshotSymbol('RELIANCE')).toEqual({ captured: 10 });
    expect(await scheduler.watchOiSnapshotSymbol('HDFCBANK')).toEqual({ captured: 10 });

    expect(state.saves.map(symbolsIn)).toEqual([['RELIANCE'], ['HDFCBANK']]);
  });

  it('does not take an extra snapshot for NIFTY, BANKNIFTY or an already-watched stock', async () => {
    expect(await scheduler.watchOiSnapshotSymbol('NIFTY')).toEqual({ captured: 0 });
    expect(await scheduler.watchOiSnapshotSymbol('BANKNIFTY')).toEqual({ captured: 0 });
    await scheduler.watchOiSnapshotSymbol('RELIANCE');
    expect(await scheduler.watchOiSnapshotSymbol('RELIANCE')).toEqual({ captured: 0 });

    expect(state.saves.map(symbolsIn)).toEqual([['RELIANCE']]);
  });

  it('takes no snapshot while the market is closed, so the stock is not watched', async () => {
    vi.setSystemTime(ist('09:00')); // pre-open
    expect(await scheduler.watchOiSnapshotSymbol('RELIANCE')).toEqual({ captured: 0 });

    vi.setSystemTime(ist('09:14'));
    await startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 1000); // 09:15 round
    expect(state.saves.map(symbolsIn)).toEqual([['BANKNIFTY', 'NIFTY']]);
  });
});

describe('the 10-minute rounds', () => {
  it('always snapshots NIFTY and BANKNIFTY, with no symbol picked', async () => {
    await startScheduler();

    expect(state.saves.map(symbolsIn)).toEqual([['BANKNIFTY', 'NIFTY']]);
    expect(state.saves[0].timeLabel).toBe('10:02');
  });

  it("stores each symbol's own spot price under its price instrument's token", async () => {
    await startScheduler();
    await scheduler.watchOiSnapshotSymbol('RELIANCE');

    const [round, reliance] = state.saves;
    expect(round.prices).toMatchObject({ 9001: 24000, 9002: 52000 });
    expect(reliance.prices).toMatchObject({ 9003: 1400 });
    expect(reliance.prices).not.toHaveProperty('9001');
    expect(reliance).not.toHaveProperty('spot');
  });

  it('snapshots a symbol ticked in Settings from the next round', async () => {
    await startScheduler(); // 10:02 round
    state.always = ['NIFTY', 'BANKNIFTY', 'RELIANCE'];

    await vi.advanceTimersByTimeAsync(8 * 60 * 1000); // 10:10, the next round

    expect(state.saves.map(symbolsIn)).toEqual([['BANKNIFTY', 'NIFTY'], ['BANKNIFTY', 'NIFTY', 'RELIANCE']]);
  });

  it('keeps a symbol unticked in Settings for the rest of the day, then stops it the next day', async () => {
    await startScheduler(); // 10:02 round
    state.always = ['NIFTY'];

    await vi.advanceTimersByTimeAsync(8 * 60 * 1000); // 10:10: already snapshotted today
    expect(symbolsIn(state.saves.at(-1))).toEqual(['BANKNIFTY', 'NIFTY']);

    vi.setSystemTime(ist('10:00', '2026-11-04')); // next trading day
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(symbolsIn(state.saves.at(-1))).toEqual(['NIFTY']);
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

  it('watches picked stocks only for that day; the next day is NIFTY and BANKNIFTY again', async () => {
    await scheduler.watchOiSnapshotSymbol('HDFCBANK');
    await scheduler.watchOiSnapshotSymbol('RELIANCE');

    vi.setSystemTime(ist('10:00', '2026-11-04')); // next trading day
    await startScheduler();

    expect(symbolsIn(state.saves.at(-1))).toEqual(['BANKNIFTY', 'NIFTY']);
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
