import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module creates a default monitor on import; keep its real dependencies out.
vi.mock('./db.js', () => ({ getAllOpenAutoPositions: vi.fn(), getOpenAutoPositions: vi.fn(), getAutomationConfigs: vi.fn(), closeAutoTradesOfPosition: vi.fn() }));
vi.mock('./paperTrading.js', () => ({ exitPaperTrade: vi.fn(), NOT_FOUND: 'NOT_FOUND' }));
vi.mock('./oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createAutoTradeMonitor, dueExits, positionPnl } = await import('./autoTradeMonitor.js');
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

describe('positionPnl', () => {
  it('gains for a bought position as the price rises, and for a sold one as it falls', () => {
    expect(positionPnl(bought, 210)).toBe(500);
    expect(positionPnl(bought, 190)).toBe(-500);
    expect(positionPnl(sold, 90)).toBe(750);
    expect(positionPnl(sold, 120)).toBe(-1500);
  });
});

describe('dueExits', () => {
  const rules = new Map([['U1', exitRules({ 'stop-loss': { amount: 1500 } })], ['U2', exitRules({ target: { amount: 500 } })]]);

  it("fires each owner's own rules on the position's P&L at the last price, exiting at that price", () => {
    const prices = new Map([[101, 120], [202, 210]]);
    expect(dueExits([sold, bought], prices, rules, NOON)).toEqual([
      { position: sold, exitPrice: 120, ruleId: 'stop-loss', reason: 'Stop-loss hit: P&L ₹-1500.00, stop-loss ₹1500' },
      { position: bought, exitPrice: 210, ruleId: 'target', reason: 'Target hit: P&L ₹500.00, target ₹500' },
    ]);
  });

  it('keeps positions open when no rule fires, with no price yet, or with no rules loaded', () => {
    expect(dueExits([sold, bought], new Map([[101, 119.95], [202, 209.95]]), rules, NOON)).toEqual([]);
    expect(dueExits([sold], new Map(), rules, NOON)).toEqual([]);
    expect(dueExits([{ ...sold, userId: 'U9' }], new Map([[101, 500]]), rules, NOON)).toEqual([]);
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
      getAutomationConfigs: vi.fn(async (ids) => new Map(ids.map((id) => [id, config(id === 'U1' ? { 'stop-loss': { amount: 1500 } } : {})]))),
      closeAutoTradesOfPosition: vi.fn(async () => ['t1']),
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

  it('exits on the tick that hits the stop-loss, at that last price, and closes the trades behind it', async () => {
    await monitor.checkMarket();
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 119.95 }]);
    expect(exitPosition).not.toHaveBeenCalled();

    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 120 }]);
    expect(exitPosition).toHaveBeenCalledWith('U1', 'p1', 120, { now: NOON });
    expect(db.closeAutoTradesOfPosition).toHaveBeenCalledWith('U1', 'p1', 120, {
      ruleId: 'stop-loss',
      reason: 'Stop-loss hit: P&L ₹-1500.00, stop-loss ₹1500',
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
    expect(db.closeAutoTradesOfPosition).not.toHaveBeenCalled();
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(exitPosition).toHaveBeenCalledTimes(2);
    expect(db.closeAutoTradesOfPosition).toHaveBeenCalledTimes(1);
  });

  it('stops watching a position already exited elsewhere (e.g. by hand), without closing trades', async () => {
    await monitor.checkMarket();
    exitPosition.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'Position not found or already exited' });
    await monitor.onTicks([{ instrumentToken: 101, lastPrice: 121 }]);
    expect(monitor.watchedPositionIds()).toEqual(['p2']);
    expect(db.closeAutoTradesOfPosition).not.toHaveBeenCalled();
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

  it('applies changed exit rules from the next tick after a refresh', async () => {
    await monitor.checkMarket();
    db.getOpenAutoPositions.mockResolvedValueOnce([bought]);
    db.getAutomationConfigs.mockResolvedValueOnce(new Map([['U2', config({ 'stop-loss': { amount: 100 } })]]));
    await monitor.refreshUser('U2');
    expect(db.getOpenAutoPositions).toHaveBeenCalledWith('U2');
    await monitor.onTicks([{ instrumentToken: 202, lastPrice: 198 }]);
    expect(exitPosition).toHaveBeenCalledWith('U2', 'p2', 198, { now: NOON });
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
});
