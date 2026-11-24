import { describe, it, expect, vi } from 'vitest';
import { Horizon } from '../../../../shared/tradeEnums.js';

// Keep the real database out of the default dependencies.
vi.mock('../../../db.js', () => ({}));
vi.mock('../../automationConfigs.js', () => ({}));

const { dueCancellations, dueExits, openPnlByUser } = await import('./autoPositions.js');
const { defaultRuleSettings } = await import('../../../../shared/rules/ruleSettings.js');
const { EXIT_RULES } = await import('../../../../shared/exitRules/index.js');
const { GENERAL_RULES } = await import('../../../../shared/generalRules/index.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const AT_SQUARE_OFF = new Date('2026-11-05T09:30:00Z'); // Thu 15:00 IST

/** Rules all inactive, except those given (active, with these values): the test strategy's exit rules and the general rules. */
const rulesOf = (list, active) => {
  const rules = defaultRuleSettings(list);
  for (const [id, params] of Object.entries(active)) if (rules[id]) rules[id] = { active: true, params: { ...rules[id].params, ...params } };
  return rules;
};
/** A user's configuration, as far as exits read it. */
const config = (active = {}) => ({ generalRules: rulesOf(GENERAL_RULES, active), strategies: { test: { exitRules: rulesOf(EXIT_RULES, active) } } });

// Sold 75 at 100: loses as the price rises.
const sold = { id: 'p1', userId: 'U1', strategyId: 'test', instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon: Horizon.Intraday, side: 'SELL', quantity: 75, entryPrice: 100 };
// Bought 50 at 200, another user, another instrument.
const bought = { id: 'p2', userId: 'U2', strategyId: 'test', instrumentToken: 202, tradingsymbol: 'NIFTY26NOV24000CE', horizon: Horizon.Intraday, side: 'BUY', quantity: 50, entryPrice: 200 };
// An automated limit order still waiting to fill, and a positional one.
const waiting = { id: 'o1', userId: 'U3', strategyId: 'test', instrumentToken: 303, tradingsymbol: 'NIFTY26NOV24100PE', horizon: Horizon.Intraday, side: 'SELL', quantity: 75 };
const waitingPositional = { ...waiting, id: 'o2', horizon: Horizon.Positional };

describe('openPnlByUser', () => {
  it("totals each user's open P&L at the last prices, counting positions with no price yet as 0", () => {
    const another = { ...sold, id: 'p3', instrumentToken: 303 };
    expect(openPnlByUser([sold, bought, another], new Map([[101, 110], [202, 210]])))
      .toEqual(new Map([['U1', -750], ['U2', 500]]));
  });
});

describe('dueExits', () => {
  const configs = new Map([['U1', config({ 'stop-loss': { percent: 20 } })], ['U2', config({ target: { percent: 5 } })]]);
  const state = (lastPrices, { configsByUser = configs, todayPnlByUser = new Map(), bestPrices = new Map() } = {}) =>
    ({ lastPrices, bestPrices, configsByUser, todayPnlByUser, now: NOON });

  it("fires the rules of each position's strategy, as its owner set them, on its P&L at the last price, exiting at that price", () => {
    const prices = new Map([[101, 120], [202, 210]]);
    expect(dueExits([sold, bought], state(prices))).toEqual([
      { position: sold, exitPrice: 120, ruleId: 'stop-loss', reason: 'Stop-loss hit (20%)' },
      { position: bought, exitPrice: 210, ruleId: 'target', reason: 'Target hit (5%)' },
    ]);
  });

  it('keeps positions open when no rule fires, with no price yet, or with no configuration loaded', () => {
    expect(dueExits([sold, bought], state(new Map([[101, 119.95], [202, 209.95]])))).toEqual([]);
    expect(dueExits([sold], state(new Map()))).toEqual([]);
    expect(dueExits([{ ...sold, userId: 'U9' }], state(new Map([[101, 500]])))).toEqual([]);
  });

  it("leaves another strategy's position to that strategy's rules", () => {
    expect(dueExits([{ ...sold, strategyId: 'other' }], state(new Map([[101, 150]])))).toEqual([]);
  });

  it("gives the general rules the owner's P&L for the day, so max loss per day closes every strategy's positions", () => {
    const maxLoss = new Map([['U1', config({ 'max-daily-loss': { amount: 5000 } })], ['U2', config({ 'max-daily-loss': { amount: 5000 } })]]);
    const positions = [sold, { ...sold, id: 'p3', strategyId: 'other' }, bought];
    const due = dueExits(positions, state(new Map([[101, 101], [202, 201]]), { configsByUser: maxLoss, todayPnlByUser: new Map([['U1', -5000], ['U2', -4999]]) }));
    expect(due.map((d) => [d.position.id, d.ruleId])).toEqual([['p1', 'max-daily-loss'], ['p3', 'max-daily-loss']]);
  });

  describe('with a trailing stop-loss on the target (target 10%, trail 5%)', () => {
    const trailing = new Map([['U2', config({ target: { percent: 10, trailPercent: 5 } })]]);
    const at = (last, best) => dueExits([bought], state(new Map([[202, last]]), { configsByUser: trailing, bestPrices: new Map([['p2', best]]) }));

    it("doesn't exit at the target, and exits once the profit falls back the trail from its best", () => {
      expect(at(220, 220)).toEqual([]); // +10%: trailing starts
      expect(at(221, 230)).toEqual([]); // best +15%, now +10.5%
      expect(at(220, 230)).toEqual([{ position: bought, exitPrice: 220, ruleId: 'target', reason: 'Trailing stop-loss hit (best 15%, trail 5%, target 10%)' }]);
    });

    it('leaves a position that never reached the target to the other rules, however far it falls from its best', () => {
      expect(at(200, 219)).toEqual([]); // best +9.5%
    });

    it('starts from the last price when no best price is known yet', () => {
      expect(dueExits([bought], state(new Map([[202, 240]]), { configsByUser: trailing }))).toEqual([]);
    });
  });
});

describe('dueCancellations', () => {
  const squareOff = new Map([['U3', config({ 'square-off': { time: '15:00' } })]]);
  const state = (now, configsByUser = squareOff, todayPnlByUser = new Map()) => ({ configsByUser, todayPnlByUser, now });

  it('cancels a waiting intraday order once the square-off time has come, with the rule as the reason', () => {
    expect(dueCancellations([waiting], state(AT_SQUARE_OFF)))
      .toEqual([{ order: waiting, ruleId: 'square-off', reason: 'Squared off at 15:00 IST' }]);
  });

  it("keeps it before the square-off time, a positional order, another strategy's order, and an order whose owner has no configuration loaded", () => {
    expect(dueCancellations([waiting], state(new Date('2026-11-05T09:29:59Z')))).toEqual([]); // 14:59 IST
    expect(dueCancellations([waitingPositional], state(AT_SQUARE_OFF))).toEqual([]);
    expect(dueCancellations([{ ...waiting, strategyId: 'other' }], state(AT_SQUARE_OFF))).toEqual([]);
    expect(dueCancellations([{ ...waiting, userId: 'U9' }], state(AT_SQUARE_OFF))).toEqual([]);
  });

  it("cancels every strategy's waiting orders once the general max loss per day is hit, not before", () => {
    const maxLoss = new Map([['U3', config({ 'max-daily-loss': { amount: 5000 } })]]);
    const other = { ...waiting, id: 'o3', strategyId: 'other' };
    expect(dueCancellations([waiting, other], state(NOON, maxLoss, new Map([['U3', -4999]])))).toEqual([]);
    expect(dueCancellations([waiting, other], state(NOON, maxLoss, new Map([['U3', -6000]]))).map((d) => [d.order.id, d.ruleId]))
      .toEqual([['o1', 'max-daily-loss'], ['o3', 'max-daily-loss']]);
  });
});
