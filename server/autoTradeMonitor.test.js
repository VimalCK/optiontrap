import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module creates a default monitor on import; keep its real dependencies out.
vi.mock('./db.js', () => ({ getAllOpenAutoPositions: vi.fn(), getOpenAutoPositions: vi.fn(), getAutomationConfigs: vi.fn(), getTodayAutoRealisedPnl: vi.fn() }));
vi.mock('./paperTrading.js', () => ({ exitPaperTrade: vi.fn(), NOT_FOUND: 'NOT_FOUND' }));
vi.mock('./oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createAutoTradeMonitor, dueExits, openPnlByUser } = await import('./autoTradeMonitor.js');
const { defaultRuleSettings } = await import('../shared/rules/ruleSettings.js');
const { EXIT_RULES } = await import('../shared/exitRules/index.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST, market open
const AFTER_CLOSE = new Date('2026-11-05T10:30:00Z'); // Thu 16:00 IST

/** Exit rules all inactive, except those given (active, with these values). */
const exitRules = (active = {}) => {
  const rules = defaultRuleSettings(EXIT_RULES);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};
const config = (active) => ({ exitRules: exitRules(active) });

// Sold 75 at 100: loses as the price rises.
const sold = { id: 'p1', userId: 'U1', instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', side: 'SELL', quantity: 75, entryPrice: 100 };
// Bought 50 at 200, another user, another instrument.
const bought = { id: 'p2', userId: 'U2', instrumentToken: 202, tradingsymbol: 'NIFTY26NOV24000CE', side: 'BUY', quantity: 50, entryPrice: 200 };

describe('openPnlByUser', () => {
  it("totals each user's open P&L at the last prices, counting positions with no price yet as 0", () => {
    const another = { ...sold, id: 'p3', instrumentToken: 303 };
    expect(openPnlByUser([sold, bought, another], new Map([[101, 110], [202, 210]])))
      .toEqual(new Map([['U1', -750], ['U2', 500]]));
  });
});

describe('dueExits', () => {
  const rules = new Map([['U1', exitRules({ 'stop-loss': { percent: 20 } })], ['U2', exitRules({ target: { percent: 5 } })]]);
  const state = (lastPrices, exitRulesByUser = rules, todayPnlByUser = new Map()) => ({ lastPrices, exitRulesByUser, todayPnlByUser, now: NOON });

  it("fires each owner's own rules on the position's P&L at the last price, exiting at that price", () => {
    const prices = new Map([[101, 120], [202, 210]]);
    expect(dueExits([sold, bought], state(prices))).toEqual([
      { position: sold, exitPrice: 120, ruleId: 'stop-loss', reason: 'Stop-loss hit: P&L -20.00% (₹-1500.00), stop-loss 20%' },
      { position: bought, exitPrice: 210, ruleId: 'target', reason: 'Target hit: P&L 5.00% (₹500.00), target 5%' },
    ]);
  });

  it('keeps positions open when no rule fires, with no price yet, or with no rules loaded', () => {
    expect(dueExits([sold, bought], state(new Map([[101, 119.95], [202, 209.95]])))).toEqual([]);
    expect(dueExits([sold], state(new Map()))).toEqual([]);
    expect(dueExits([{ ...sold, userId: 'U9' }], state(new Map([[101, 500]])))).toEqual([]);
  });

  it("gives the rules the owner's P&L for the day, so max loss per day closes their positions", () => {
    const maxLoss = new Map([['U1', exitRules({ 'max-daily-loss': { amount: 5000 } })], ['U2', exitRules({ 'max-daily-loss': { amount: 5000 } })]]);
    const due = dueExits([sold, bought], state(new Map([[101, 101], [202, 201]]), maxLoss, new Map([['U1', -5000], ['U2', -4999]])));
    expect(due.map((d) => [d.position.id, d.ruleId])).toEqual([['p1', 'max-daily-loss']]);
  });
});

describe('the monitor', () => {
  let db;
  let exitPosition;
  let feeds;
  let now;
  let monitor;

  beforeEach(() => {
    now = NOON;
    db = {
      getAllOpenAutoPositions: vi.fn(async () => [sold, bought]),
      getOpenAutoPositions: vi.fn(async () => []),
      getAutomationConfigs: vi.fn(async (ids) => new Map(ids.map((id) => [id, config(id === 'U1' ? { 'stop-loss': { percent: 20 } } : {})]))),
      getTodayAutoRealisedPnl: vi.fn(async () => 0),
    };
    exitPosition = vi.fn(async () => ({ ok: true }));
    feeds = [];
    monitor = createAutoTradeMonitor({
      db,
      exitPosition,
      findKiteSession: async () => ({ apiKey: 'key', accessToken: 'token' }),
      createFeed: (options) => {
        const feed = { options, watching: [], watch: vi.fn((tokens) => { feed.watching = tokens; }), close: vi.fn() };
        feeds.push(feed);
        return feed;
      },
      clock: () => now,
      log: () => {},
    });
  });

  it('at the market open loads every open automated position and watches exactly their instruments', async () => {
    await monitor.checkMarket();
    expect(monitor.watchedPositionIds()).toEqual(['p1', 'p2']);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].options.kite).toEqual({ apiKey: 'key', accessToken: 'token' });
    expect(feeds[0].watching.sort()).toEqual([101, 202]);
  });

  it('exits on the tick that hits the stop-loss, at that last price, with the rule’s reason for the trades behind it', async () => {
    await monitor.checkMarket();
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 119.95 }]);
    expect(exitPosition).not.toHaveBeenCalled();

    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 120 }]);
    expect(exitPosition).toHaveBeenCalledWith('U1', 'p1', 120, {
      now: NOON,
      exitReason: { ruleId: 'stop-loss', reason: 'Stop-loss hit: P&L -20.00% (₹-1500.00), stop-loss 20%' },
      fillFrom: { apiKey: 'key', accessToken: 'token' }, // a market exit at the bid / ask, quoted with the feed's session
    });
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
    expect(feeds[0].watching).toEqual([202]);
  });

  it('exits a position once, however many ticks arrive while it is exiting', async () => {
    await monitor.checkMarket();
    let finish;
    exitPosition.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 122 }]);
    finish({ ok: true });
    await first;
    expect(exitPosition).toHaveBeenCalledTimes(1);
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 125 }]);
    expect(exitPosition).toHaveBeenCalledTimes(1);
  });

  it('keeps watching a position the paper rules refused to exit, and tries again on the next tick', async () => {
    await monitor.checkMarket();
    exitPosition.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: 'The market is closed.' });
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(monitor.watchedPositionIds()).toContain('p1');
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(exitPosition).toHaveBeenCalledTimes(2);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
  });

  it('stops watching a position already exited elsewhere (e.g. by hand)', async () => {
    await monitor.checkMarket();
    exitPosition.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'Position not found or already exited' });
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
  });

  it('squares off on the clock at the time set, on the last price, even with no new tick', async () => {
    db.getAutomationConfigs.mockImplementation(async (ids) => new Map(ids.map((id) => [id, config({ 'square-off': { time: '15:00' } })])));
    await monitor.checkMarket();
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 101 }, { instrumentToken: 202, lastPrice: 199 }]);
    expect(exitPosition).not.toHaveBeenCalled();

    now = new Date('2026-11-05T09:30:00Z'); // 15:00 IST
    await monitor.checkClock();
    expect(exitPosition.mock.calls.map((c) => [c[1], c[2]])).toEqual([['p1', 101], ['p2', 199]]);
  });

  it("squares off all of a user's positions, winners too, once their day's loss (booked + open) reaches the limit", async () => {
    // U1: sold 75 at 100 (p1), bought 50 at 200 (p4), sold 75 at 100 (p5); ₹1,000 already booked as a loss today.
    const boughtU1 = { ...bought, id: 'p4', userId: 'U1', instrumentToken: 404 };
    const winner = { ...sold, id: 'p5', instrumentToken: 505 };
    db.getAllOpenAutoPositions.mockResolvedValue([sold, boughtU1, winner, bought]);
    db.getAutomationConfigs.mockImplementation(async (ids) => new Map(ids.map((id) => [id, config({ 'max-daily-loss': { amount: 5000 } })])));
    db.getTodayAutoRealisedPnl.mockImplementation(async (userId) => (userId === 'U1' ? -1000 : 0));
    await monitor.checkMarket();
    expect(db.getTodayAutoRealisedPnl).toHaveBeenCalledWith('U1', '2026-11-04T18:30:00.000Z'); // midnight IST

    // Open: p1 −2,250, p4 −2,000, p5 +750 → day −4,500: under the limit.
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 130 }, { instrumentToken: 404, lastPrice: 160 }, { instrumentToken: 505, lastPrice: 90 }, { instrumentToken: 202, lastPrice: 200 }]);
    expect(exitPosition).not.toHaveBeenCalled();

    // p1 to 137 (−2,775) → day −5,025: p1 exits on its tick, booking its loss.
    db.getTodayAutoRealisedPnl.mockImplementation(async (userId) => (userId === 'U1' ? -3775 : 0));
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 137 }]);
    expect(exitPosition).toHaveBeenCalledWith('U1', 'p1', 137, expect.objectContaining({
      exitReason: { ruleId: 'max-daily-loss', reason: "Max loss per day hit: today's automated P&L ₹-5025.00, limit ₹5000" },
    }));

    // The day is still −5,025 (now mostly booked), so the rest go on the next check, the winner too; U2's stays.
    await monitor.checkClock();
    expect(exitPosition.mock.calls.map((c) => c[1])).toEqual(['p1', 'p4', 'p5']);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
  });

  it('applies changed exit rules from the next tick after a refresh', async () => {
    await monitor.checkMarket();
    db.getOpenAutoPositions.mockResolvedValueOnce([bought]);
    db.getAutomationConfigs.mockResolvedValueOnce(new Map([['U2', config({ 'stop-loss': { percent: 1 } })]]));
    await monitor.refreshUser('U2');
    expect(db.getOpenAutoPositions).toHaveBeenCalledWith('U2');
    await monitor.onTicks([{ instrumentToken: 202, lastPrice: 198 }]);
    expect(exitPosition).toHaveBeenCalledWith('U2', 'p2', 198, expect.objectContaining({ now: NOON }));
  });

  it("drops a user's positions they no longer hold on refresh, leaving other users' alone", async () => {
    await monitor.checkMarket();
    await monitor.refreshUser('U1'); // U1 now holds nothing
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
    expect(feeds[0].watching).toEqual([202]);
  });

  it('does nothing outside market hours, and closes the feed after the close', async () => {
    now = AFTER_CLOSE;
    await monitor.checkMarket();
    expect(db.getAllOpenAutoPositions).not.toHaveBeenCalled();
    expect(feeds).toHaveLength(0);

    now = NOON;
    await monitor.checkMarket();
    now = AFTER_CLOSE;
    await monitor.checkMarket();
    expect(feeds[0].close).toHaveBeenCalled();
    expect(await monitor.checkClock()).toEqual([]);
  });

  it('opens no feed when there is nothing to watch, and waits for an admin login without failing', async () => {
    db.getAllOpenAutoPositions.mockResolvedValueOnce([]);
    await monitor.checkMarket();
    expect(feeds).toHaveLength(0);

    const noLogin = createAutoTradeMonitor({ db, exitPosition, findKiteSession: async () => null, createFeed: () => { throw new Error('no feed expected'); }, clock: () => NOON, log: () => {} });
    await noLogin.checkMarket();
    expect(noLogin.watchedPositionIds()).toEqual(['p1', 'p2']);
  });

  it('reports its state for the health page: checks, feed, what it watches and the last tick', async () => {
    expect(monitor.status()).toMatchObject({ lastCheckAt: null, feedConnected: false, lastTickAt: null });
    await monitor.checkMarket();
    expect(monitor.status()).toEqual({
      lastCheckAt: NOON.getTime(), marketOpen: true, feedConnected: true, waitingForLogin: false,
      watchedPositions: 2, watchedInstruments: 2, lastTickAt: null, lastError: null,
    });
    await monitor.onTicks([{ instrumentToken: 202, lastPrice: 201 }]);
    expect(monitor.status().lastTickAt).toBe(NOON.getTime());

    now = AFTER_CLOSE;
    await monitor.checkMarket();
    expect(monitor.status()).toMatchObject({ lastCheckAt: AFTER_CLOSE.getTime(), marketOpen: false, feedConnected: false });
  });

  it('reports waiting for an admin login, and a market check that failed until one works', async () => {
    const noLogin = createAutoTradeMonitor({ db, exitPosition, findKiteSession: async () => null, createFeed: () => { throw new Error('no feed expected'); }, clock: () => NOON, log: () => {} });
    await noLogin.checkMarket();
    expect(noLogin.status()).toMatchObject({ waitingForLogin: true, feedConnected: false, watchedPositions: 2 });

    db.getAllOpenAutoPositions.mockRejectedValueOnce(new Error('db down'));
    await expect(monitor.checkMarket()).rejects.toThrow('db down');
    expect(monitor.status().lastError).toBe('db down');
    await monitor.checkMarket();
    expect(monitor.status().lastError).toBeNull();
  });
});
