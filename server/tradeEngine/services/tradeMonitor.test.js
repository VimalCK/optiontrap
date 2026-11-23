import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Horizon } from '../../../shared/tradeEnums.js';

// Keep the real database and Kite session lookup out of the default dependencies.
vi.mock('../../db.js', () => ({}));
vi.mock('../automationConfigs.js', () => ({}));
vi.mock('../positions.js', () => ({ NOT_FOUND: 'NOT_FOUND' }));
vi.mock('../../oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createTradeMonitor, monitorHealth } = await import('./tradeMonitor.js');
const { defaultRuleSettings } = await import('../../../shared/rules/ruleSettings.js');
const { EXIT_RULES } = await import('../../../shared/exitRules/index.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST, market open
const AFTER_CLOSE = new Date('2026-11-05T10:30:00Z'); // Thu 16:00 IST

/** Exit rules all inactive, except those given (active, with these values). */
const exitRules = (active = {}) => {
  const rules = defaultRuleSettings(EXIT_RULES);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params: { ...rules[id].params, ...params } };
  return rules;
};
const config = (active) => ({ exitRules: exitRules(active) });

// Sold 75 at 100: loses as the price rises.
const sold = { id: 'p1', userId: 'U1', instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon: Horizon.Intraday, side: 'SELL', quantity: 75, entryPrice: 100 };
// Bought 50 at 200, another user, another instrument.
const bought = { id: 'p2', userId: 'U2', instrumentToken: 202, tradingsymbol: 'NIFTY26NOV24000CE', horizon: Horizon.Intraday, side: 'BUY', quantity: 50, entryPrice: 200 };
// An automated limit order still waiting to fill, and a positional one.
const waiting = { id: 'o1', userId: 'U3', instrumentToken: 303, tradingsymbol: 'NIFTY26NOV24100PE', horizon: Horizon.Intraday, side: 'SELL', quantity: 75 };
// A manual position bought at 100 with the order popup's target 120 and stop-loss 90, held by U1.
const manual = { id: 'm1', userId: 'U1', instrumentToken: 505, tradingsymbol: 'NIFTY26NOV24100CE', horizon: Horizon.Intraday, side: 'BUY', quantity: 75,
  entryPrice: 100, targetPrice: 120, stopLossPrice: 90, trailAmount: null };
const AT_SQUARE_OFF = new Date('2026-11-05T09:30:00Z'); // Thu 15:00 IST

describe('the monitor service', () => {
  const ADMIN_KITE = { apiKey: 'key', accessToken: 'token' };
  let db;
  let orders;
  let feeds;
  let now;
  let monitor;
  let market;

  /** Start a monitor on a fake market clock, and give its open / close / repeat handlers to call. */
  function start(target) {
    const handlers = { open: [], close: [], every: [] };
    target.start({
      market: {
        isOpen: () => now === NOON,
        onOpen: (fn) => handlers.open.push(fn),
        onClose: (fn) => handlers.close.push(fn),
        every: (ms, fn) => handlers.every.push({ ms, fn }),
      },
      services: { orders },
      log: () => {},
    });
    const repeat = (ms) => Promise.all(handlers.every.filter((h) => h.ms === ms).map((h) => h.fn()));
    return {
      open: () => Promise.all(handlers.open.map((fn) => fn())),
      close: () => Promise.all(handlers.close.map((fn) => fn())),
      clockCheck: () => repeat(1000),
      feedCheck: () => repeat(60_000),
    };
  }

  const create = (deps = {}) => createTradeMonitor({
    db,
    findKiteSession: async () => ADMIN_KITE,
    createFeed: (options) => {
      const feed = { options, watching: [], watch: vi.fn((tokens) => { feed.watching = tokens; }), close: vi.fn() };
      feeds.push(feed);
      return feed;
    },
    clock: () => now,
    log: () => {},
    ...deps,
  });

  beforeEach(() => {
    now = NOON;
    db = {
      getAllOpenAutoPositions: vi.fn(async () => [sold, bought]),
      getOpenAutoPositions: vi.fn(async () => []),
      getAutomationConfigs: vi.fn(async (ids) => new Map(ids.map((id) => [id, config(id === 'U1' ? { 'stop-loss': { percent: 20 } } : {})]))),
      getTodayAutoRealisedPnl: vi.fn(async () => 0),
      getAllOpenManualPositionsWithExits: vi.fn(async () => []),
      getOpenManualPositionsWithExits: vi.fn(async () => []),
    };
    orders = {
      waiting: [],
      waitingAutoOrders: () => orders.waiting,
      cancel: vi.fn(async (userId, id) => ({ ok: true, order: { id } })),
      exit: vi.fn(async (userId, positionId, { exitPrice }) => ({ ok: true, order: { fillPrice: exitPrice } })),
      onSettled: vi.fn((listener) => { orders.settledListener = listener; return () => { orders.settledListener = null; }; }),
    };
    feeds = [];
    monitor = create();
    market = start(monitor);
  });

  const exitedIds = () => orders.exit.mock.calls.map((c) => c[1]);

  it('at the market open loads every open automated position and watches exactly their instruments', async () => {
    await market.open();
    expect(monitor.watchedPositionIds()).toEqual(['p1', 'p2']);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].options.kite).toEqual(ADMIN_KITE);
    expect(feeds[0].watching.sort()).toEqual([101, 202]);
  });

  it("exits through the order service on the tick that hits the stop-loss, with the rule's reason for the trades behind it", async () => {
    await market.open();
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 119.95 }]);
    expect(orders.exit).not.toHaveBeenCalled();

    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 120 }]);
    expect(orders.exit).toHaveBeenCalledWith('U1', 'p1', {
      exitPrice: 120,
      kite: ADMIN_KITE, // a market exit at the bid / ask, quoted with the feed's session
      source: 'Auto',
      exitReason: { ruleId: 'stop-loss', reason: 'Stop-loss hit (20%)' },
    });
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
    expect(feeds[0].watching).toEqual([202]);
  });

  it('exits a position once, however many ticks arrive while it is exiting', async () => {
    await market.open();
    let finish;
    orders.exit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 122 }]);
    finish({ ok: true, order: { fillPrice: 121 } });
    await first;
    expect(orders.exit).toHaveBeenCalledTimes(1);
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 125 }]);
    expect(orders.exit).toHaveBeenCalledTimes(1);
  });

  it('keeps watching a position the rules refused to exit, and tries again on the next tick', async () => {
    await market.open();
    orders.exit.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: 'The market is closed.' });
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(monitor.watchedPositionIds()).toContain('p1');
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(orders.exit).toHaveBeenCalledTimes(2);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
  });

  it('stops watching a position already exited elsewhere (e.g. by hand)', async () => {
    await market.open();
    orders.exit.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'Position not found or already exited' });
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
  });

  it('squares off on the clock check at the time set, on the last price, even with no new tick', async () => {
    db.getAutomationConfigs.mockImplementation(async (ids) => new Map(ids.map((id) => [id, config({ 'square-off': { time: '15:00' } })])));
    await market.open();
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 101 }, { instrumentToken: 202, lastPrice: 199 }]);
    expect(orders.exit).not.toHaveBeenCalled();

    now = new Date('2026-11-05T09:30:00Z'); // 15:00 IST
    await market.clockCheck();
    expect(orders.exit.mock.calls.map((c) => [c[1], c[2].exitPrice])).toEqual([['p1', 101], ['p2', 199]]);
  });

  it("cancels a user's waiting automated orders at the square-off time, loading the rules of an owner with no position", async () => {
    db.getAutomationConfigs.mockImplementation(async (ids) => new Map(ids.map((id) => [id, config({ 'square-off': { time: '15:00' } })])));
    await market.open();
    orders.waiting = [waiting];
    await market.clockCheck();
    expect(orders.cancel).not.toHaveBeenCalled();

    now = AT_SQUARE_OFF;
    await market.clockCheck();
    expect(orders.cancel.mock.calls).toEqual([['U3', 'o1', 'Cancelled: Squared off at 15:00 IST']]);
    expect(db.getAutomationConfigs).toHaveBeenLastCalledWith(['U3']);
  });

  it("squares off all of a user's positions, winners too, once their day's loss (booked + open) reaches the limit", async () => {
    // U1: sold 75 at 100 (p1), bought 50 at 200 (p4), sold 75 at 100 (p5); ₹1,000 already booked as a loss today.
    const boughtU1 = { ...bought, id: 'p4', userId: 'U1', instrumentToken: 404 };
    const winner = { ...sold, id: 'p5', instrumentToken: 505 };
    db.getAllOpenAutoPositions.mockResolvedValue([sold, boughtU1, winner, bought]);
    db.getAutomationConfigs.mockImplementation(async (ids) => new Map(ids.map((id) => [id, config({ 'max-daily-loss': { amount: 5000 } })])));
    db.getTodayAutoRealisedPnl.mockImplementation(async (userId) => (userId === 'U1' ? -1000 : 0));
    await market.open();
    expect(db.getTodayAutoRealisedPnl).toHaveBeenCalledWith('U1', '2026-11-04T18:30:00.000Z'); // midnight IST

    // Open: p1 −2,250, p4 −2,000, p5 +750 → day −4,500: under the limit.
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 130 }, { instrumentToken: 404, lastPrice: 160 }, { instrumentToken: 505, lastPrice: 90 }, { instrumentToken: 202, lastPrice: 200 }]);
    expect(orders.exit).not.toHaveBeenCalled();

    // p1 to 137 (−2,775) → day −5,025: p1 exits on its tick, booking its loss.
    db.getTodayAutoRealisedPnl.mockImplementation(async (userId) => (userId === 'U1' ? -3775 : 0));
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 137 }]);
    expect(orders.exit).toHaveBeenCalledWith('U1', 'p1', expect.objectContaining({
      exitPrice: 137,
      exitReason: { ruleId: 'max-daily-loss', reason: "Max loss per day hit: today's automated P&L ₹-5025.00, limit ₹5000" },
    }));

    // The day is still −5,025 (now mostly booked), so the rest go on the next check, the winner too; U2's stays.
    await market.clockCheck();
    expect(exitedIds()).toEqual(['p1', 'p4', 'p5']);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
  });

  it('applies changed exit rules from the next tick after a refresh', async () => {
    await market.open();
    db.getOpenAutoPositions.mockResolvedValueOnce([bought]);
    db.getAutomationConfigs.mockResolvedValueOnce(new Map([['U2', config({ 'stop-loss': { percent: 1 } })]]));
    await monitor.refreshUser('U2');
    expect(db.getOpenAutoPositions).toHaveBeenCalledWith('U2');
    await monitor.onTicks([{ instrumentToken: 202, lastPrice: 198 }]);
    expect(orders.exit).toHaveBeenCalledWith('U2', 'p2', expect.objectContaining({ exitPrice: 198 }));
  });

  it("drops a user's positions they no longer hold on refresh, leaving other users' alone", async () => {
    await market.open();
    await monitor.refreshUser('U1'); // U1 now holds nothing
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
    expect(feeds[0].watching).toEqual([202]);
  });

  it('reloads the owner in every channel when they fill an order by hand, not on its own exits or cancels, and stops listening when stopped', async () => {
    await market.open();
    await orders.settledListener({ userId: 'U1', source: 'Auto', status: 'Filled', closesPosition: true });
    await orders.settledListener({ userId: 'U1', source: 'Manual', status: 'Cancelled', closesPosition: false });
    expect(db.getOpenAutoPositions).not.toHaveBeenCalled();
    expect(db.getOpenManualPositionsWithExits).not.toHaveBeenCalled();
    await orders.settledListener({ userId: 'U1', source: 'Manual', status: 'Filled', closesPosition: true });
    expect(db.getOpenAutoPositions).toHaveBeenCalledWith('U1');
    expect(db.getOpenManualPositionsWithExits).toHaveBeenCalledWith('U1');
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
    monitor.stop();
    expect(orders.settledListener).toBeNull();
  });

  it('ignores a refresh before the open, and stops watching after the close', async () => {
    await monitor.refreshUser('U1');
    expect(db.getOpenAutoPositions).not.toHaveBeenCalled();

    await market.open();
    now = AFTER_CLOSE;
    await market.close();
    expect(feeds[0].close).toHaveBeenCalled();
    await market.clockCheck();
    expect(orders.exit).not.toHaveBeenCalled();
    await monitor.refreshUser('U1');
    expect(db.getOpenAutoPositions).not.toHaveBeenCalled();
  });

  it('opens no feed when there is nothing to watch, and waits for an admin login, watching once a check finds one', async () => {
    db.getAllOpenAutoPositions.mockResolvedValueOnce([]);
    await market.open();
    expect(feeds).toHaveLength(0);

    let kite = null;
    const noLogin = create({ findKiteSession: async () => kite });
    const noLoginMarket = start(noLogin);
    await noLoginMarket.open();
    expect(noLogin.watchedPositionIds()).toEqual(['p1', 'p2']);
    expect(noLogin.status()).toMatchObject({ waitingForLogin: true, feedConnected: false, watchedPositions: 2 });
    kite = ADMIN_KITE;
    await noLoginMarket.feedCheck();
    expect(noLogin.status()).toMatchObject({ waitingForLogin: false, feedConnected: true });
  });

  it('reports its state for Admin Services: feed, what it watches, the last tick and a failed load', async () => {
    expect(monitor.status()).toMatchObject({ feedConnected: false, lastTickAt: null });
    await market.open();
    expect(monitor.status()).toEqual({
      marketOpen: true, feedConnected: true, waitingForLogin: false,
      watchedPositions: 2, watchedInstruments: 2, lastTickAt: null, lastError: null,
    });
    await monitor.onTicks([{ instrumentToken: 202, lastPrice: 201 }]);
    expect(monitor.status().lastTickAt).toBe(NOON.getTime());

    db.getAllOpenAutoPositions.mockRejectedValueOnce(new Error('db down'));
    await expect(market.open()).rejects.toThrow('db down');
    expect(monitor.status().lastError).toBe('db down');
    await market.open();
    expect(monitor.status().lastError).toBeNull();
  });

  it("trails an automated position from its owner's target and exits once the profit falls back the trail", async () => {
    db.getAutomationConfigs.mockImplementation(async (ids) => new Map(ids.map((id) => [id, config({ target: { percent: 10, trailPercent: 5 } })])));
    await market.open();
    for (const lastPrice of [220, 230, 221]) await monitor.onTicks([{ instrumentToken: 202, lastPrice }]); // +10%, best +15%, +10.5%
    expect(orders.exit).not.toHaveBeenCalled();
    await monitor.onTicks([{ instrumentToken: 202, lastPrice: 220 }]);
    expect(orders.exit).toHaveBeenCalledWith('U2', 'p2', expect.objectContaining({
      exitPrice: 220, exitReason: { ruleId: 'target', reason: 'Trailing stop-loss hit (best 15%, trail 5%, target 10%)' },
    }));
  });

  describe('the manual channel', () => {
    beforeEach(() => {
      db.getAllOpenManualPositionsWithExits.mockResolvedValue([manual]);
    });

    it("watches open manual positions with their order's levels, beside the automated ones", async () => {
      await market.open();
      expect(monitor.watchedPositionIds()).toEqual(['p1', 'p2', 'm1']);
      expect(feeds[0].watching.sort()).toEqual([101, 202, 505]);
    });

    it('exits at the target as the engine, with the reason, and stops watching it', async () => {
      await market.open();
      await monitor.onTicks([{ instrumentToken: 505, lastPrice: 119.95 }]);
      expect(orders.exit).not.toHaveBeenCalled();
      await monitor.onTicks([{ instrumentToken: 505, lastPrice: 120 }]);
      expect(orders.exit).toHaveBeenCalledWith('U1', 'm1', {
        exitPrice: 120, kite: ADMIN_KITE, source: 'Auto', exitReason: { ruleId: 'target', reason: 'Target hit (₹120)' },
      });
      expect(monitor.watchedPositionIds()).toEqual(['p1', 'p2']);
    });

    it("leaves it to its own levels: its owner's automated exit rules don't touch it", async () => {
      // U1's automated stop-loss is 20%; the manual position (a buy) is down 25% but above its own stop-loss of 70.
      db.getAllOpenManualPositionsWithExits.mockResolvedValue([{ ...manual, stopLossPrice: 70 }]);
      await market.open();
      await monitor.onTicks([{ instrumentToken: 505, lastPrice: 75 }]);
      expect(orders.exit).not.toHaveBeenCalled();
    });

    it('trails the best price from the target with a trailing stop-loss, exiting once the price falls back the trail', async () => {
      db.getAllOpenManualPositionsWithExits.mockResolvedValue([{ ...manual, trailAmount: 5 }]);
      await market.open();
      for (const lastPrice of [120, 130, 125.05]) await monitor.onTicks([{ instrumentToken: 505, lastPrice }]);
      expect(orders.exit).not.toHaveBeenCalled();
      await monitor.onTicks([{ instrumentToken: 505, lastPrice: 125 }]);
      expect(orders.exit).toHaveBeenCalledWith('U1', 'm1', expect.objectContaining({
        exitPrice: 125, exitReason: { ruleId: 'target', reason: 'Trailing stop-loss hit (best ₹130, trail ₹5, target ₹120)' },
      }));
    });

    it("picks up a user's new manual position on refresh", async () => {
      db.getAllOpenManualPositionsWithExits.mockResolvedValue([]);
      await market.open();
      db.getOpenManualPositionsWithExits.mockResolvedValueOnce([manual]);
      await monitor.refreshUser('U1');
      expect(monitor.watchedPositionIds()).toContain('m1');
      expect(feeds[0].watching).toContain(505);
    });
  });

  it('stops watching when the engine stops it', async () => {
    await market.open();
    monitor.stop();
    expect(feeds[0].close).toHaveBeenCalled();
    expect(monitor.watchedPositionIds()).toEqual([]);
  });
});

describe('monitorHealth', () => {
  const TICK = new Date('2026-11-05T06:29:30Z'); // Thu 11:59:30 IST
  const status = (changes = {}) => ({
    marketOpen: true, feedConnected: true, waitingForLogin: false,
    watchedPositions: 2, watchedInstruments: 1, lastTickAt: TICK.getTime(), lastError: null, ...changes,
  });

  it('passes while watching, timed at the last tick', () => {
    expect(monitorHealth(status())).toEqual({ status: 'Pass', output: 'Watching 2 positions in 1 instrument · last tick', time: TICK.toISOString() });
    expect(monitorHealth(status({ lastTickAt: null }))).toEqual({ status: 'Pass', output: 'Watching 2 positions in 1 instrument · no tick yet', time: null });
  });

  it('passes when there is nothing to watch: market closed, no open positions', () => {
    expect(monitorHealth(status({ marketOpen: false, feedConnected: false }))).toEqual({ status: 'Pass', output: 'Market closed · watches open positions in market hours', time: null });
    expect(monitorHealth(status({ feedConnected: false, watchedPositions: 0 }))).toEqual({ status: 'Pass', output: 'No open positions to watch', time: null });
  });

  it('fails, named as the trade monitor, when positions go unwatched for want of an admin login, or loading them failed', () => {
    expect(monitorHealth(status({ feedConnected: false, waitingForLogin: true, watchedPositions: 1 })))
      .toEqual({ status: 'Fail', output: 'Trade monitor · 1 open position unwatched · no admin Kite login', time: null });
    expect(monitorHealth(status({ lastError: 'db down' }))).toEqual({ status: 'Fail', output: 'Trade monitor · Loading positions failed · db down', time: null });
  });
});
