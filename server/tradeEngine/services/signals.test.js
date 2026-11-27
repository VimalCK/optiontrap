import { describe, it, expect, vi } from 'vitest';
import { Horizon } from '../../../shared/tradeEnums.js';

// Keep the real database, Kite and instrument list out of the default dependencies.
vi.mock('../../db.js', () => ({}));
vi.mock('../automationConfigs.js', () => ({}));
vi.mock('../../kiteQuotes.js', () => ({ fetchQuotes: vi.fn() }));
vi.mock('../../oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));
vi.mock('../../instruments.js', () => ({ getOrFetchInstruments: vi.fn() }));
vi.mock('../strategies/index.js', () => ({ STRATEGIES: [] }));

const { createSignalsService, planTrade, refusal, signalsHealth } = await import('./signals.js');
const { defaultAutomationConfig } = await import('../../../shared/automation.js');
const { entryRuleContexts } = await import('../../../shared/entryRules/index.js');
const { checkTrade, normalizeTradeInput } = await import('../../../shared/tradeRules.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const KITE = { apiKey: 'k', accessToken: 't' };

const option = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', name: 'NIFTY', exchange: 'NFO', instrumentType: 'PE', strike: 24000, expiry: '2026-11-26', lotSize: 75 };
const stock = { instrumentToken: 202, tradingsymbol: 'INFY', name: 'INFY', exchange: 'NSE', instrumentType: 'EQ', strike: null, expiry: null, lotSize: null };
const instruments = [option, stock];
const byToken = new Map(instruments.map((i) => [i.instrumentToken, i]));
const indexNames = new Set(['NIFTY']);

const TEST_STRATEGY = { id: 'test', label: 'Test', description: '', params: [] };

/** Automation on, the test strategy active on paper, intraday, trading 2 lots (its Max lots active at 2). */
const userConfig = () => {
  const config = defaultAutomationConfig([TEST_STRATEGY]);
  config.enabled = true;
  config.strategies.test.active = true;
  config.strategies.test.entryRules['max-lots'] = { active: true, params: { max: 2 } };
  return config;
};
/** The test strategy's own settings in a config. */
const own = (config) => config.strategies.test;

const sellOption = { instrumentToken: 101, side: 'SELL', reason: 'test signal' };
/** A strategy that gives each user the prepared signals it can place for them. */
const strategy = () => ({
  ...TEST_STRATEGY, start: () => {},
  prepare: vi.fn(),
  select: vi.fn((prepared, _params, { allows }) => prepared.filter(allows)),
});

/**
 * A signals service with fakes for everything it talks to. The fake order
 * service fills a market order at once (or refuses the fill when `fillRefused`
 * is given) and tells the listener, as the real one does; a limit order gets `placed`.
 */
function setup({ config = userConfig(), users = [{ userId: 'U1', config }], prices = { 'NFO:NIFTY26NOV24000PE': 120 }, placed = { ok: true, order: { status: 'Open' } }, fillRefused = null } = {}) {
  const db = {
    // As the real one: the users with automation on and this strategy active.
    getAutomatedUsers: vi.fn(async (strategyId) => users.filter(({ config: c }) => c.enabled && c.strategies[strategyId]?.active)),
    getUnderlyings: vi.fn().mockResolvedValue([{ name: 'NIFTY', isIndex: true }, { name: 'INFY', isIndex: false }]),
    createAutoTrade: vi.fn().mockResolvedValue('T1'),
    advanceAutoTrade: vi.fn().mockResolvedValue(true),
    getOpenAutoPositions: vi.fn().mockResolvedValue([]),
    getTodayAutoRealisedPnl: vi.fn().mockResolvedValue(0),
    getTodayAutoExits: vi.fn().mockResolvedValue([]),
    getWaitingAutoOrders: vi.fn().mockResolvedValue([]),
  };
  let listener = null;
  const orders = {
    onSettled: vi.fn((fn) => { listener = fn; return () => { listener = null; }; }),
    placeAuto: vi.fn(async (userId, order, { lastPrice, fillPrice, autoTradeId, strategyId }) => {
      if (order.orderType !== 'Market') return placed;
      const base = { userId, autoTradeId, strategyId, source: 'Auto', side: order.side, quantity: order.quantity, tradingsymbol: order.tradingsymbol, orderType: 'Market', closesPosition: false };
      const settled = fillRefused
        ? { ...base, status: 'Cancelled', statusReason: fillRefused }
        : { ...base, status: 'Filled', fillPrice: fillPrice ?? lastPrice, positionId: 'pos1' };
      await listener?.(settled);
      return { ok: true, order: settled };
    }),
  };
  const monitor = { openPnl: vi.fn().mockReturnValue(0), refreshUser: vi.fn(async () => {}) };
  const deps = {
    db,
    strategies: [strategy()],
    quotes: vi.fn().mockResolvedValue(Object.fromEntries(Object.entries(prices).map(([k, p]) => [k, { last_price: p }]))),
    findKiteSession: vi.fn(async () => KITE),
    loadInstruments: vi.fn(async () => instruments),
    clock: () => NOON,
    log: vi.fn(),
  };
  const service = createSignalsService(deps);
  service.start({ market: /** @type {any} */ ({}), services: { orders, tradeMonitor: monitor }, log: () => {} });
  return { ...deps, orders, monitor, service, submit: (signals = [sellOption]) => service.submit('test', signals) };
}

/** The stage moves recorded, as 'from→to'. */
const moves = (db) => db.advanceAutoTrade.mock.calls.map(([, , from, to]) => `${from}→${to}`);

describe('planTrade', () => {
  it('plans trades the real trade rules accept: options carry their option type', () => {
    const future = { ...option, instrumentToken: 404, tradingsymbol: 'NIFTY26NOVFUT', instrumentType: 'FUT', strike: null };
    const instruments = new Map([...byToken, [404, future]]);
    for (const signal of [sellOption, { instrumentToken: 404, side: 'BUY', reason: '' }, { instrumentToken: 202, side: 'BUY', reason: '' }]) {
      const { trade } = planTrade(signal, instruments, indexNames, own(userConfig()), 'Paper');
      const verdict = checkTrade('Open', { trade: normalizeTradeInput({ ...trade, entryPrice: 100 }), now: NOON });
      expect(verdict).toEqual({ ok: true });
    }
  });

  it("sizes the trade at the strategy's Max lots value × the lot size, in the mode given, with details from the instrument list", () => {
    const { trade } = planTrade(sellOption, byToken, indexNames, own(userConfig()), 'Paper');
    expect(trade).toMatchObject({ kind: 'IndexOption', side: 'SELL', tradingsymbol: 'NIFTY26NOV24000PE', exchange: 'NFO', lotSize: 75, quantity: 150, horizon: Horizon.Intraday, mode: 'Paper' });
  });

  it('trades 1 lot while the Max lots rule is off', () => {
    const settings = own(userConfig());
    settings.entryRules['max-lots'] = { active: false, params: { max: 5 } };
    expect(planTrade(sellOption, byToken, indexNames, settings, 'Paper').trade?.quantity).toBe(75);
  });

  it('takes index or stock from the underlyings, and trades a stock in shares', () => {
    const { trade } = planTrade({ instrumentToken: 202, side: 'BUY', reason: '' }, byToken, indexNames, own(userConfig()), 'Paper');
    expect(trade).toMatchObject({ kind: 'Stock', lotSize: 1, quantity: 2 });
  });

  it('refuses an instrument not in the list, or an index itself', () => {
    expect(planTrade({ instrumentToken: 999, side: 'BUY', reason: '' }, byToken, indexNames, own(userConfig()), 'Paper').error).toMatch(/999/);
    const index = { ...stock, instrumentToken: 303, tradingsymbol: 'NIFTY 50', name: 'NIFTY' };
    expect(planTrade({ instrumentToken: 303, side: 'BUY', reason: '' }, new Map([[303, index]]), indexNames, own(userConfig()), 'Paper').error).toMatch(/can't be traded/);
  });
});

describe('refusal', () => {
  const account = (extra = {}) => ({ now: NOON, openAutoPositions: [], waitingAutoOrders: [], todayAutoPnl: 0, todayAutoExits: [], ...extra });
  const contexts = (extra) => entryRuleContexts(account(extra), 'test');
  const trade = planTrade(sellOption, byToken, indexNames, own(userConfig()), 'Paper').trade;

  it('allows a trade the settings allow', () => {
    expect(refusal(trade, userConfig(), 'test', contexts())).toBeNull();
  });

  it("checks the account switch and the strategy's own settings before any rule", () => {
    const config = userConfig();
    own(config).active = false;
    own(config).entryRules['max-lots'] = { active: true, params: { max: 1 } };
    expect(refusal(trade, config, 'test', contexts())).toEqual({ ruleId: null, reason: 'The strategy is inactive' });
    expect(refusal(trade, { ...userConfig(), enabled: false }, 'test', contexts())).toEqual({ ruleId: null, reason: 'Algo Trading is off' });
  });

  it("refuses it once the strategy's square-off time has come, as the square-off would close it at once", () => {
    const config = userConfig();
    own(config).exitRules['square-off'] = { active: true, params: { time: '15:00' } };
    expect(refusal(trade, config, 'test', contexts({ now: new Date('2026-11-05T09:29:59Z') }))).toBeNull(); // Thu 14:59 IST
    expect(refusal(trade, config, 'test', contexts({ now: new Date('2026-11-05T09:30:00Z') }))) // Thu 15:00 IST
      .toEqual({ ruleId: 'square-off', reason: 'Squared off at 15:00 IST' });
  });

  it('refuses every entry once the general max loss per day is hit', () => {
    const config = userConfig();
    config.generalRules['max-daily-loss'] = { active: true, params: { amount: 1000 } };
    expect(refusal(trade, config, 'test', contexts({ todayAutoPnl: -1000 })))
      .toEqual({ ruleId: 'max-daily-loss', reason: "Max loss per day hit: today's automated P&L ₹-1000.00, limit ₹1000" });
  });

  it("counts every strategy's positions for the general rules, only the strategy's own for its rules", () => {
    const config = userConfig();
    config.generalRules['max-open-positions'] = { active: true, params: { max: 1 } };
    expect(refusal(trade, config, 'test', contexts({ openAutoPositions: [{ instrumentToken: 5, strategyId: 'other' }] }))?.ruleId).toBe('max-open-positions');

    const perInstrument = userConfig();
    own(perInstrument).entryRules['one-trade-per-instrument'] = { active: true, params: {} };
    expect(refusal(trade, perInstrument, 'test', contexts({ openAutoPositions: [{ instrumentToken: 101, strategyId: 'other' }] }))).toBeNull();
    expect(refusal(trade, perInstrument, 'test', contexts({ openAutoPositions: [{ instrumentToken: 101, strategyId: 'test' }] }))?.ruleId).toBe('one-trade-per-instrument');
  });
});

describe('submitting a strategy\'s signals', () => {
  it('executes a signal: selected, validated, then a market order filled into an automated position', async () => {
    const { db, submit, orders, monitor } = setup();
    await submit();
    expect(db.createAutoTrade).toHaveBeenCalledWith('U1', expect.objectContaining({ quantity: 150, side: 'SELL' }), { strategyId: 'test', setup: null, reason: 'test signal' });
    expect(orders.placeAuto).toHaveBeenCalledWith('U1', expect.objectContaining({ tradingsymbol: 'NIFTY26NOV24000PE', quantity: 150, orderType: 'Market' }),
      { lastPrice: 120, fillPrice: null, autoTradeId: 'T1', strategyId: 'test' });
    expect(moves(db)).toEqual(['Selected→Validated', 'Validated→Executed']);
    expect(db.advanceAutoTrade.mock.calls[1][4]).toEqual({ entryPrice: 120, positionId: 'pos1' });
    expect(monitor.refreshUser).toHaveBeenCalledWith('U1');
  });

  it('fills a market entry at the bid / ask in the same quote: a sell at the best bid', async () => {
    const { db, submit, orders, quotes } = setup();
    quotes.mockResolvedValue({ 'NFO:NIFTY26NOV24000PE': { last_price: 120, depth: { buy: [{ price: 119.6 }], sell: [{ price: 120.4 }] } } });
    await submit();
    expect(orders.placeAuto.mock.calls[0][2]).toEqual({ lastPrice: 120, fillPrice: 119.6, autoTradeId: 'T1', strategyId: 'test' });
    expect(db.advanceAutoTrade.mock.calls[1][4]).toEqual({ entryPrice: 119.6, positionId: 'pos1' });
  });

  it('quotes with the admin session and plans from its instrument list', async () => {
    const { submit, quotes, loadInstruments } = setup();
    await submit();
    expect(loadInstruments).toHaveBeenCalledWith('k', 't');
    expect(quotes).toHaveBeenCalledWith(KITE, ['NFO:NIFTY26NOV24000PE']);
  });

  it('saves nothing when a rule refuses the signal: it only logs why, and places nothing', async () => {
    const config = userConfig();
    config.generalRules['max-daily-loss'] = { active: true, params: { amount: 1000 } };
    const run = setup({ config });
    run.db.getTodayAutoRealisedPnl.mockResolvedValue(-800);
    run.monitor.openPnl.mockReturnValue(-300); // booked + open = -1100
    await run.submit();
    expect(run.db.createAutoTrade).not.toHaveBeenCalled();
    expect(run.db.advanceAutoTrade).not.toHaveBeenCalled();
    expect(run.orders.placeAuto).not.toHaveBeenCalled();
    expect(run.log).toHaveBeenCalledWith('not entered', expect.objectContaining({ trade: 'SELL 150 NIFTY26NOV24000PE', user: 'U1', strategy: 'test', reason: expect.stringContaining("today's automated P&L ₹-1100.00") }));
  });

  it("doesn't re-enter an instrument within the Wait after exit minutes of the strategy's last exit today", async () => {
    const config = userConfig();
    own(config).entryRules['wait-after-exit'] = { active: true, params: { minutes: 15 } };
    const run = setup({ config });
    run.db.getTodayAutoExits.mockResolvedValue([{ instrumentToken: 101, strategyId: 'test', exitTime: new Date(NOON.getTime() - 10 * 60_000) }]);
    await run.submit();
    expect(run.db.getTodayAutoExits).toHaveBeenCalledWith('U1', '2026-11-04T18:30:00.000Z'); // the IST day's start
    expect(run.db.createAutoTrade).not.toHaveBeenCalled();
    expect(run.log).toHaveBeenCalledWith('not entered', expect.objectContaining({ reason: expect.stringContaining('was exited at 11:50 IST; waiting until 12:05 IST') }));
  });

  it('rejects after validation when there is no last price', async () => {
    const run = setup({ prices: {} });
    await run.submit();
    expect(moves(run.db)).toEqual(['Selected→Validated', 'Validated→Rejected']);
    expect(run.db.advanceAutoTrade.mock.calls[1][4]).toEqual({ reason: 'No last price for NIFTY26NOV24000PE' });
    expect(run.orders.placeAuto).not.toHaveBeenCalled();
  });

  it('rejects after validation when the fill is refused (its order cancelled with why)', async () => {
    const run = setup({ fillRefused: 'Market is closed' });
    await run.submit();
    expect(moves(run.db)).toEqual(['Selected→Validated', 'Validated→Rejected']);
    expect(run.db.advanceAutoTrade.mock.calls[1][4]).toEqual({ reason: 'Market is closed' });
    expect(run.monitor.refreshUser).not.toHaveBeenCalled();
  });

  it("doesn't trade a strategy with paper and live both off", async () => {
    const config = userConfig();
    own(config).execution.Paper = false;
    const run = setup({ config });
    await run.submit();
    expect(run.db.createAutoTrade).not.toHaveBeenCalled();
  });

  it('does no work when no user has the strategy active, or it gives no signals', async () => {
    const inactiveConfig = userConfig();
    own(inactiveConfig).active = false;
    const inactive = setup({ config: inactiveConfig });
    await inactive.submit();
    expect(inactive.db.getAutomatedUsers).toHaveBeenCalledWith('test');
    expect(inactive.strategies[0].select).not.toHaveBeenCalled();
    expect(inactive.quotes).not.toHaveBeenCalled();

    const quiet = setup();
    await quiet.submit([]);
    expect(quiet.quotes).not.toHaveBeenCalled();
    expect(quiet.db.createAutoTrade).not.toHaveBeenCalled();
  });

  it("selects each user's signals with their own settings, from one prepared result", async () => {
    const u2 = userConfig();
    own(u2).params = { minScore: 90 };
    const run = setup({ users: [{ userId: 'U1', config: userConfig() }, { userId: 'U2', config: u2 }] });
    await run.submit();
    expect(run.strategies[0].select.mock.calls.map(([prepared, params]) => [prepared, params])).toEqual([[[sellOption], {}], [[sellOption], { minScore: 90 }]]);
    expect(run.db.createAutoTrade.mock.calls.map(([userId]) => userId)).toEqual(['U1', 'U2']);
  });

  it("takes users at the same time: one user's slow checks don't hold up the next", async () => {
    const run = setup({ users: [{ userId: 'U1', config: userConfig() }, { userId: 'U2', config: userConfig() }] });
    let releaseU1;
    run.db.getOpenAutoPositions.mockImplementation((userId) => (userId === 'U1' ? new Promise((resolve) => { releaseU1 = () => resolve([]); }) : Promise.resolve([])));
    const submitted = run.submit();
    await vi.waitFor(() => expect(run.db.createAutoTrade.mock.calls.map(([userId]) => userId)).toEqual(['U2']));
    releaseU1();
    await submitted;
    expect(run.db.createAutoTrade.mock.calls.map(([userId]) => userId)).toEqual(['U2', 'U1']);
  });

  it("takes one user's signals in turn, each checked after the one before was placed", async () => {
    const run = setup();
    const order = [];
    run.db.getOpenAutoPositions.mockImplementation(async () => { order.push('check'); return []; });
    run.orders.placeAuto.mockImplementation(async () => { order.push('place'); return { ok: true, order: { status: 'Open' } }; });
    await run.submit([sellOption, sellOption]);
    expect(order).toEqual(['check', 'place', 'check', 'place']);
  });

  it('lets a strategy pick only what it can place, so nothing it would skip is recorded', async () => {
    const unknown = { instrumentToken: 999, side: 'BUY', reason: 'not in the list' };
    const run = setup();
    await run.submit([unknown, sellOption]);
    expect(run.strategies[0].select.mock.results[0].value).toEqual([sellOption]);
    expect(run.db.createAutoTrade).toHaveBeenCalledTimes(1);
    expect(run.db.createAutoTrade.mock.calls[0][1]).toMatchObject({ side: 'SELL' });
  });

  it('keeps going with the next signal when one fails', async () => {
    const run = setup();
    run.db.createAutoTrade.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('T2');
    await run.submit([sellOption, sellOption]);
    expect(run.log).toHaveBeenCalledWith('signal failed', expect.objectContaining({ error: 'db down' }));
    expect(run.monitor.refreshUser).toHaveBeenCalledTimes(1);
  });

  it('keeps the last submit for status: the strategy, users, signals and the signals that failed', async () => {
    const run = setup();
    expect(run.service.status()).toEqual({ lastRun: null });
    run.db.createAutoTrade.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('T2');
    await run.submit([sellOption, sellOption]);
    expect(run.service.status()).toEqual({ lastRun: { strategyId: 'test', at: NOON.getTime(), users: 1, signals: 2, failed: 1, error: null } });
  });

  it('records a submit with nothing to do, and one that fails, which it still throws', async () => {
    const quiet = setup();
    await quiet.submit([]);
    expect(quiet.service.status().lastRun).toEqual({ strategyId: 'test', at: NOON.getTime(), users: 1, signals: 0, failed: 0, error: null });

    const noLogin = setup();
    noLogin.findKiteSession.mockResolvedValueOnce(null);
    await expect(noLogin.submit()).rejects.toThrow('No admin Kite login');
    expect(noLogin.service.status().lastRun).toMatchObject({ users: 0, signals: 0, error: 'No admin Kite login for the instrument list and quotes' });

    await expect(quiet.service.submit('nope', [])).rejects.toThrow('unknown strategy nope');
  });
});

describe('entering through a limit order (Entry limit offset on)', () => {
  /** userConfig with Entry limit offset at `points` rupees. */
  const offsetConfig = (points = 24) => {
    const config = userConfig();
    own(config).entryRules['entry-limit-offset'] = { active: true, params: { points } };
    return config;
  };

  it('places a sell limit that many rupees above the last price, linked to the trade, and opens nothing yet', async () => {
    const { db, submit, orders, monitor } = setup({ config: offsetConfig(24) });
    await submit();
    expect(orders.placeAuto).toHaveBeenCalledWith('U1', expect.objectContaining({ tradingsymbol: 'NIFTY26NOV24000PE', side: 'SELL', quantity: 150, orderType: 'Limit', limitPrice: 144 }),
      { lastPrice: 120, fillPrice: null, autoTradeId: 'T1', strategyId: 'test' });
    expect(moves(db)).toEqual(['Selected→Validated']); // validated while the order waits
    expect(monitor.refreshUser).not.toHaveBeenCalled();
  });

  it('rejects the trade when the order is refused', async () => {
    const { db, submit } = setup({ config: offsetConfig(), placed: { ok: false, code: 'MARKET_CLOSED', message: 'The market is closed.' } });
    await submit();
    expect(moves(db)).toEqual(['Selected→Validated', 'Validated→Rejected']);
    expect(db.advanceAutoTrade.mock.calls[1][4]).toEqual({ reason: 'The market is closed.' });
  });

  it("doesn't place a second order in an instrument whose automated order is still waiting", async () => {
    const config = offsetConfig();
    own(config).entryRules['one-trade-per-instrument'] = { active: true, params: {} };
    const run = setup({ config });
    run.db.getWaitingAutoOrders.mockResolvedValue([{ instrumentToken: 101, strategyId: 'test' }]);
    await run.submit();
    expect(run.orders.placeAuto).not.toHaveBeenCalled();
    expect(run.log).toHaveBeenCalledWith('not entered', expect.objectContaining({ reason: expect.stringContaining('An automated limit order in NIFTY26NOV24000PE is already waiting') }));
  });
});

describe('settleOrder', () => {
  const autoOrder = (extra) => ({ userId: 'U1', autoTradeId: 'T1', source: 'Auto', side: 'SELL', quantity: 150, tradingsymbol: 'NIFTY26NOV24000PE', closesPosition: false, ...extra });

  it('executes the trade at the fill price into the position the order opened, and hands it to the trade monitor', async () => {
    const { db, service, monitor } = setup();
    await service.settleOrder(autoOrder({ status: 'Filled', fillPrice: 144, positionId: 'pos9' }));
    expect(db.advanceAutoTrade).toHaveBeenCalledWith('U1', 'T1', 'Validated', 'Executed', { entryPrice: 144, positionId: 'pos9' }, { entryPrice: 144, positionId: 'pos9' });
    expect(monitor.refreshUser).toHaveBeenCalledWith('U1');
  });

  it('rejects the trade with why its order was cancelled', async () => {
    const { db, service, monitor } = setup();
    await service.settleOrder(autoOrder({ status: 'Cancelled', statusReason: 'Cancelled at market close' }));
    expect(db.advanceAutoTrade).toHaveBeenCalledWith('U1', 'T1', 'Validated', 'Rejected', { reason: 'Cancelled at market close' }, { ruleId: null, reason: 'Cancelled at market close' });
    expect(monitor.refreshUser).not.toHaveBeenCalled();
  });

  it('ignores orders placed by hand, and exits', async () => {
    const { db, service } = setup();
    await service.settleOrder(autoOrder({ source: 'Manual', autoTradeId: null, status: 'Filled', fillPrice: 50, positionId: 'p' }));
    await service.settleOrder(autoOrder({ autoTradeId: null, closesPosition: true, status: 'Filled', fillPrice: 50, positionId: 'p' }));
    expect(db.advanceAutoTrade).not.toHaveBeenCalled();
  });

  it('stops hearing about orders when the engine stops it', () => {
    const { service, orders } = setup();
    expect(orders.onSettled).toHaveBeenCalledWith(service.settleOrder);
    service.stop();
    expect(service.status()).toEqual({ lastRun: null });
  });
});

describe('signalsHealth', () => {
  const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
  const run = (changes = {}) => ({ strategyId: 's', at: NOON.getTime(), users: 2, signals: 3, failed: 0, error: null, ...changes });

  it('passes before the first run, with no time', () => {
    expect(signalsHealth(null)).toEqual({ status: 'Pass', output: 'No run yet · runs when a strategy has a new signal', time: null });
  });

  it('passes after a clean run, saying how many users and signals, at the run time', () => {
    expect(signalsHealth(run())).toEqual({ status: 'Pass', output: 'Last run · 2 users · 3 signals', time: NOON.toISOString() });
    expect(signalsHealth(run({ users: 1, signals: 1 })).output).toBe('Last run · 1 user · 1 signal');
  });

  it('warns when some signals failed, and fails when the run failed', () => {
    expect(signalsHealth(run({ failed: 1 }))).toEqual({ status: 'Warn', output: 'Last run · 2 users · 3 signals · 1 failed', time: NOON.toISOString() });
    expect(signalsHealth(run({ error: 'db down' }))).toEqual({ status: 'Fail', output: 'Last run failed · db down', time: NOON.toISOString() });
  });
});
