import { describe, it, expect, vi } from 'vitest';

// Keep the real database, Kite session lookup and instrument list out of the default dependencies.
vi.mock('../../db.js', () => ({ getLatestOiSnapshotTimestamp: vi.fn(), getTodayOiSnapshots: vi.fn(), getUnderlyings: vi.fn() }));
vi.mock('../../oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));
vi.mock('../../instruments.js', () => ({ getOrFetchInstruments: vi.fn() }));

const { createOptionAnalyzerSetups, optionAnalyzerSetups, underlyingSetups } = await import('./optionAnalyzerSetups.js');
const { StrategyId } = await import('./index.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const SPOT_TOKEN = 900;
const STRIKES = Array.from({ length: 21 }, (_, i) => 24000 + (i - 10) * 50);
const option = (strike, type, expiry, i) => ({
  instrumentToken: (expiry === '2026-11-10' ? 1000 : 5000) + i * 2 + (type === 'CE' ? 0 : 1),
  tradingsymbol: `X${expiry}${strike}${type}`, name: 'X', exchange: 'NFO', instrumentType: type, strike, expiry,
});
// The nearest expiry, a later one, and one already past.
const options = ['2026-11-10', '2026-11-17', '2026-11-03'].flatMap((expiry) =>
  STRIKES.flatMap((strike, i) => ['CE', 'PE'].map((type) => option(strike, type, expiry, i))));
const nearest = options.filter((o) => o.expiry === '2026-11-10');

/** A snapshot where OI builds at the 24200 CE and 23800 PE as `f` grows; spot sits at 24010. */
const snapshot = (timestamp, f) => {
  const data = {};
  const prices = { [SPOT_TOKEN]: 24010 };
  const volumes = {};
  for (const o of nearest) {
    const steps = (o.strike - 24000) / 50;
    const otm = o.instrumentType === 'CE' ? steps : -steps;
    const wall = (o.strike === 24200 && o.instrumentType === 'CE') || (o.strike === 23800 && o.instrumentType === 'PE');
    data[o.instrumentToken] = Math.round((100000 * (1 + (wall ? 3 * f : 0))) / (1 + Math.abs(steps) * 0.1));
    prices[o.instrumentToken] = Math.max(2, 120 - otm * 20 - f * 5);
    volumes[o.instrumentToken] = 5000;
  }
  return { timestamp, timeLabel: '', data, prices, volumes };
};
const snapshots = [snapshot(1, 0), snapshot(2, 0.5), snapshot(3, 1), snapshot(4, 1.5)];
const input = { now: NOON, snapshots, instruments: options, underlyings: [{ name: 'X', instrumentToken: SPOT_TOKEN, isIndex: true }] };

describe('underlyingSetups', () => {
  const setups = underlyingSetups({ name: 'X', instrumentToken: SPOT_TOKEN }, options, input);
  const byToken = new Map(options.map((o) => [o.instrumentToken, o]));

  it('takes the card\'s suggestions for the nearest expiry, best score first', () => {
    expect(setups.length).toBeGreaterThan(0);
    expect(setups.every((s) => byToken.get(s.instrumentToken)?.expiry === '2026-11-10')).toBe(true);
    expect(setups.map((s) => s.score)).toEqual([...setups.map((s) => s.score)].sort((a, b) => b - a));
  });

  it('trades the single option the card suggested, at the side and premium it showed', () => {
    for (const setup of setups) {
      const traded = byToken.get(setup.instrumentToken);
      expect(setup.side).toBe('SELL');
      expect(snapshots[3].prices[setup.instrumentToken]).toBe(setup.premium);
      expect(setup.reason).toContain(`premium ₹${setup.premium.toFixed(2)}`);
      expect(setup.reason.startsWith(`${setup.setup} · `)).toBe(true); // the setup is the card's pattern
      expect(['CE', 'PE']).toContain(traded?.instrumentType);
    }
  });

  it('has nothing when the underlying\'s spot is not in the snapshot, or it has no expiry left', () => {
    expect(underlyingSetups({ name: 'X', instrumentToken: 999 }, options, input)).toEqual([]);
    expect(underlyingSetups({ name: 'X', instrumentToken: SPOT_TOKEN }, options.filter((o) => o.expiry === '2026-11-03'), input)).toEqual([]);
  });

  it('has nothing with fewer than two snapshots, like the card', () => {
    expect(underlyingSetups({ name: 'X', instrumentToken: SPOT_TOKEN }, options, { ...input, snapshots: snapshots.slice(-1) })).toEqual([]);
  });
});

describe('optionAnalyzerSetups', () => {
  const setup = (underlying, instrumentToken, side, score, premium) => ({ underlying, instrumentToken, side, score, premium, setup: 'Bull put', reason: `${underlying} ${instrumentToken}` });
  // Best first per underlying, as prepare gives them.
  const prepared = [
    setup('X', 1, 'SELL', 80, 3),
    setup('X', 2, 'BUY', 70, 40),
    setup('X', 3, 'SELL', 60, 25),
    setup('Y', 4, 'SELL', 50, 30),
  ];
  const all = () => true;
  const pick = (params, allows = all) => optionAnalyzerSetups.select(prepared, params, { allows }).map((s) => s.instrumentToken);

  it('takes the highest-scored setup per underlying that reaches both minimums', () => {
    expect(pick({ minScore: 50, minPremium: 1 })).toEqual([1, 4]);
  });

  it('skips a setup whose premium is below Min premium, taking the next best', () => {
    expect(pick({ minScore: 50, minPremium: 10 })).toEqual([2, 4]);
  });

  it('skips setups below Min score', () => {
    expect(pick({ minScore: 65, minPremium: 10 })).toEqual([2]);
  });

  it('takes only what the user\'s General settings allow (e.g. sells only)', () => {
    expect(pick({ minScore: 50, minPremium: 10 }, (s) => s.side === 'SELL')).toEqual([3, 4]);
  });

  it('gives signals with just the instrument, side, reason and setup', () => {
    expect(optionAnalyzerSetups.select(prepared, { minScore: 50, minPremium: 1 }, { allows: all })[0])
      .toEqual({ instrumentToken: 1, side: 'SELL', reason: 'X 1', setup: 'Bull put' });
  });

  it('prepares setups for each snapshotted underlying with options', () => {
    const setups = optionAnalyzerSetups.prepare({
      ...input,
      underlyings: [...input.underlyings, { name: 'NO-OPTIONS', instrumentToken: 77, isIndex: false }, { name: 'X2', instrumentToken: null, isIndex: false }],
    });
    expect(setups).toEqual(underlyingSetups({ name: 'X', instrumentToken: SPOT_TOKEN }, nearest, input));
  });
});

describe('optionAnalyzerSetups running on the market clock', () => {
  const ADMIN_KITE = { apiKey: 'key', accessToken: 'token' };

  /** A strategy on a fake market clock and signals service, with the latest snapshot time to change. */
  function setup({ kite = ADMIN_KITE } = {}) {
    const state = { latest: 1000 };
    const db = {
      getLatestOiSnapshotTimestamp: vi.fn(async () => state.latest),
      getTodayOiSnapshots: vi.fn(async () => snapshots),
      getUnderlyings: vi.fn(async () => input.underlyings),
    };
    const loadInstruments = vi.fn(async () => options);
    const strategy = createOptionAnalyzerSetups({ db, findKiteSession: async () => kite, loadInstruments, clock: () => NOON });
    const handlers = { open: [], every: [] };
    const submit = vi.fn(async () => {});
    const logs = [];
    strategy.start({
      market: { isOpen: () => true, onOpen: (fn) => handlers.open.push(fn), onClose: () => () => {}, every: (ms, fn) => handlers.every.push({ ms, fn }) },
      services: { signals: { submit } },
      log: (event, details) => logs.push([event, details]),
    });
    return {
      state, submit, logs, loadInstruments,
      open: () => Promise.all(handlers.open.map((fn) => fn())),
      check: () => Promise.all(handlers.every.map(({ fn }) => fn())),
      interval: handlers.every[0].ms,
    };
  }

  it('looks for a new snapshot every 30 seconds', () => {
    expect(setup().interval).toBe(30_000);
  });

  it('marks the latest snapshot seen at the open, so a restart never trades it again', async () => {
    const run = setup();
    await run.open();
    await run.check();
    expect(run.submit).not.toHaveBeenCalled();
  });

  it('scores each new snapshot once and hands it to the signals service, with its id', async () => {
    const run = setup();
    await run.open();
    run.state.latest = 2000;
    await run.check();
    await run.check();
    expect(run.submit).toHaveBeenCalledTimes(1);
    expect(run.submit).toHaveBeenCalledWith(StrategyId.OptionAnalyzerSetups, optionAnalyzerSetups.prepare(input));
    expect(run.loadInstruments).toHaveBeenCalledWith('key', 'token');
  });

  it('does nothing before the first snapshot of the day', async () => {
    const run = setup();
    run.state.latest = null;
    await run.open();
    await run.check();
    expect(run.submit).not.toHaveBeenCalled();
  });

  it('skips a new snapshot, logging why, when no admin is logged in to Kite for the instrument list', async () => {
    const run = setup({ kite: null });
    await run.open();
    run.state.latest = 2000;
    await run.check();
    expect(run.submit).not.toHaveBeenCalled();
    expect(run.logs).toEqual([['skipped snapshot', { reason: 'no admin Kite login for the instrument list' }]]);
  });
});
