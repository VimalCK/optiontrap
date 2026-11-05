import { describe, it, expect, vi } from 'vitest';

// The module creates a default engine on import; keep its real dependencies out.
vi.mock('./db.js', () => ({
  advanceAutoTrade: vi.fn(), createAutoTrade: vi.fn(), getAutomatedUsers: vi.fn(), getOpenAutoPositions: vi.fn(),
  getTodayAutoRealisedPnl: vi.fn(), getTodayOiSnapshots: vi.fn(), getUnderlyings: vi.fn(),
}));
vi.mock('./paperTrading.js', () => ({ openPaperTrade: vi.fn() }));
vi.mock('./kiteQuotes.js', () => ({ fetchQuotes: vi.fn() }));
vi.mock('./autoTradeMonitor.js', () => ({ openAutoTradePnl: vi.fn(), refreshAutoTradeMonitor: vi.fn() }));

const { createAutoTradeEngine, planTrade, refusal } = await import('./autoTradeEngine.js');
const { defaultAutomationConfig } = await import('../shared/automation.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const KITE = { apiKey: 'k', accessToken: 't' };

const option = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', name: 'NIFTY', exchange: 'NFO', instrumentType: 'PE', strike: 24000, expiry: '2026-11-26', lotSize: 75 };
const stock = { instrumentToken: 202, tradingsymbol: 'INFY', name: 'INFY', exchange: 'NSE', instrumentType: 'EQ', strike: null, expiry: null, lotSize: null };
const instruments = [option, stock];
const byToken = new Map(instruments.map((i) => [i.instrumentToken, i]));
const indexNames = new Set(['NIFTY']);

/** Automation on, 2 lots (Max lots active at 2), selling index options allowed, the test strategy active. */
const userConfig = (changes = {}) => {
  const config = defaultAutomationConfig();
  config.enabled = true;
  config.entryRules['max-lots'] = { active: true, params: { max: 2 } };
  config.kinds['index-option'].SELL = true;
  config.strategies = { test: { active: true, params: {} } };
  return { ...config, ...changes };
};

const sellOption = { instrumentToken: 101, side: 'SELL', reason: 'test signal' };
/** A strategy that sees `signals` and gives each user the ones their General settings allow. */
const strategy = (signals) => ({
  id: 'test', label: 'Test', description: '', params: [],
  prepare: vi.fn(() => signals),
  select: vi.fn((prepared, _params, { allows }) => prepared.filter(allows)),
});

/** An engine with fakes for everything it talks to. */
function setup({ config = userConfig(), users = [{ userId: 'U1', config }], signals = [sellOption], prices = { 'NFO:NIFTY26NOV24000PE': 120 }, opened = { ok: true, position: { id: 'pos1' } } } = {}) {
  const db = {
    getAutomatedUsers: vi.fn().mockResolvedValue(users),
    getTodayOiSnapshots: vi.fn().mockResolvedValue([]),
    getUnderlyings: vi.fn().mockResolvedValue([{ name: 'NIFTY', isIndex: true }, { name: 'INFY', isIndex: false }]),
    createAutoTrade: vi.fn().mockResolvedValue('T1'),
    advanceAutoTrade: vi.fn().mockResolvedValue(true),
    getOpenAutoPositions: vi.fn().mockResolvedValue([]),
    getTodayAutoRealisedPnl: vi.fn().mockResolvedValue(0),
  };
  const deps = {
    db,
    strategies: [strategy(signals)],
    openPosition: vi.fn().mockResolvedValue(opened),
    quotes: vi.fn().mockResolvedValue(Object.fromEntries(Object.entries(prices).map(([k, p]) => [k, { last_price: p }]))),
    openPnl: vi.fn().mockReturnValue(0),
    onExecuted: vi.fn(),
    log: vi.fn(),
  };
  const engine = createAutoTradeEngine(deps);
  return { ...deps, run: () => engine.run({ now: NOON, kite: KITE, instruments }) };
}

/** The stage moves recorded, as 'from→to'. */
const moves = (db) => db.advanceAutoTrade.mock.calls.map(([, , from, to]) => `${from}→${to}`);

describe('planTrade', () => {
  it('sizes the trade at the Max lots value × the lot size, with details from the instrument list', () => {
    const { trade } = planTrade(sellOption, byToken, indexNames, userConfig());
    expect(trade).toMatchObject({ kind: 'index-option', side: 'SELL', tradingsymbol: 'NIFTY26NOV24000PE', exchange: 'NFO', lotSize: 75, quantity: 150, horizon: 'intraday', mode: 'paper' });
  });

  it('trades 1 lot while the Max lots rule is off', () => {
    const config = userConfig();
    config.entryRules['max-lots'] = { active: false, params: { max: 5 } };
    expect(planTrade(sellOption, byToken, indexNames, config).trade?.quantity).toBe(75);
  });

  it('takes index or stock from the underlyings, and trades a stock in shares', () => {
    const { trade } = planTrade({ instrumentToken: 202, side: 'BUY', reason: '' }, byToken, indexNames, userConfig());
    expect(trade).toMatchObject({ kind: 'stock', lotSize: 1, quantity: 2 });
  });

  it('refuses an instrument not in the list, or an index itself', () => {
    expect(planTrade({ instrumentToken: 999, side: 'BUY', reason: '' }, byToken, indexNames, userConfig()).error).toMatch(/999/);
    const index = { ...stock, instrumentToken: 303, tradingsymbol: 'NIFTY 50', name: 'NIFTY' };
    expect(planTrade({ instrumentToken: 303, side: 'BUY', reason: '' }, new Map([[303, index]]), indexNames, userConfig()).error).toMatch(/can't be traded/);
  });
});

describe('refusal', () => {
  const ctx = { openAutoPositions: [], todayAutoPnl: 0 };
  const trade = planTrade(sellOption, byToken, indexNames, userConfig()).trade;

  it('allows a trade the settings allow', () => {
    expect(refusal(trade, userConfig(), ctx)).toBeNull();
  });

  it('checks the General settings before the entry rules', () => {
    const config = userConfig();
    config.kinds['index-option'].SELL = false;
    config.entryRules['max-lots'] = { active: true, params: { max: 1 } };
    expect(refusal(trade, config, ctx)).toEqual({ ruleId: null, reason: 'Sell Index option is off' });
  });

  it('names the entry rule that refuses it', () => {
    const config = userConfig();
    config.entryRules['max-open-positions'] = { active: true, params: { max: 1 } };
    expect(refusal(trade, config, { ...ctx, openAutoPositions: [{ instrumentToken: 5 }] })?.ruleId).toBe('max-open-positions');
  });
});

describe('createAutoTradeEngine run', () => {
  it('executes a signal: selected, validated, then executed at the last price as an automated position', async () => {
    const { db, run, openPosition, onExecuted } = setup();
    await run();
    expect(db.createAutoTrade).toHaveBeenCalledWith('U1', expect.objectContaining({ quantity: 150, side: 'SELL' }), { strategyId: 'test', reason: 'test signal' });
    expect(moves(db)).toEqual(['selected→validated', 'validated→executed']);
    expect(openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ tradingsymbol: 'NIFTY26NOV24000PE', entryPrice: 120, quantity: 150 }), { now: NOON, source: 'auto' });
    expect(db.advanceAutoTrade.mock.calls[1][4]).toEqual({ entryPrice: 120, positionId: 'pos1' });
    expect(onExecuted).toHaveBeenCalledWith('U1');
  });

  it('rejects at selection when an entry rule refuses, and opens nothing', async () => {
    const config = userConfig();
    config.entryRules['max-daily-loss'] = { active: true, params: { amount: 1000 } };
    const engine = setup({ config });
    engine.db.getTodayAutoRealisedPnl.mockResolvedValue(-800);
    engine.openPnl.mockReturnValue(-300); // booked + open = -1100
    await engine.run();
    expect(moves(engine.db)).toEqual(['selected→rejected']);
    expect(engine.db.advanceAutoTrade.mock.calls[0][5]).toMatchObject({ ruleId: 'max-daily-loss' });
    expect(engine.openPosition).not.toHaveBeenCalled();
  });

  it('rejects after validation when there is no last price', async () => {
    const engine = setup({ prices: {} });
    await engine.run();
    expect(moves(engine.db)).toEqual(['selected→validated', 'validated→rejected']);
    expect(engine.db.advanceAutoTrade.mock.calls[1][4]).toEqual({ reason: 'No last price for NIFTY26NOV24000PE' });
    expect(engine.openPosition).not.toHaveBeenCalled();
  });

  it('rejects after validation when the paper trade rules refuse it', async () => {
    const engine = setup({ opened: { ok: false, message: 'Market is closed' } });
    await engine.run();
    expect(moves(engine.db)).toEqual(['selected→validated', 'validated→rejected']);
    expect(engine.db.advanceAutoTrade.mock.calls[1][4]).toEqual({ reason: 'Market is closed' });
    expect(engine.onExecuted).not.toHaveBeenCalled();
  });

  it('does no work when no user has the strategy active, or it sees nothing', async () => {
    const inactive = setup({ config: userConfig({ strategies: { test: { active: false, params: {} } } }) });
    await inactive.run();
    expect(inactive.strategies[0].prepare).not.toHaveBeenCalled();
    expect(inactive.quotes).not.toHaveBeenCalled();

    const quiet = setup({ signals: [] });
    await quiet.run();
    expect(quiet.quotes).not.toHaveBeenCalled();
    expect(quiet.db.createAutoTrade).not.toHaveBeenCalled();
  });

  it('prepares each strategy once per run, for all users', async () => {
    const engine = setup({ users: [{ userId: 'U1', config: userConfig() }, { userId: 'U2', config: userConfig() }] });
    await engine.run();
    expect(engine.strategies[0].prepare).toHaveBeenCalledTimes(1);
    expect(engine.strategies[0].prepare).toHaveBeenCalledWith(expect.objectContaining({ now: NOON, instruments, snapshots: [] }));
    expect(engine.strategies[0].select).toHaveBeenCalledTimes(2);
    expect(engine.db.createAutoTrade.mock.calls.map(([userId]) => userId)).toEqual(['U1', 'U2']);
  });

  it('lets a strategy pick only what the General settings allow, so nothing switched off is recorded', async () => {
    const buyOption = { instrumentToken: 101, side: 'BUY', reason: 'buy signal' };
    const engine = setup({ signals: [buyOption, sellOption] }); // buying index options is off
    await engine.run();
    expect(engine.db.createAutoTrade).toHaveBeenCalledTimes(1);
    expect(engine.db.createAutoTrade.mock.calls[0][1]).toMatchObject({ side: 'SELL' });
  });

  it('does nothing at all while there are no strategies', async () => {
    const engine = setup();
    const empty = createAutoTradeEngine({ ...engine, strategies: [] });
    await empty.run({ now: NOON, kite: KITE, instruments });
    expect(engine.db.getAutomatedUsers).not.toHaveBeenCalled();
  });

  it('keeps going with the next signal when one fails', async () => {
    const engine = setup({ signals: [sellOption, sellOption] });
    engine.db.createAutoTrade.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('T2');
    await engine.run();
    expect(engine.log).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(engine.onExecuted).toHaveBeenCalledTimes(1);
  });
});
