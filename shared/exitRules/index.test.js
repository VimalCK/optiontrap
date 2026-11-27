import { describe, it, expect } from 'vitest';
import { EXIT_RULES, checkEntryOrderBlocked, checkExitRules, exitLabel } from './index.js';
import { defaultRuleSettings, ruleSettingsWithDefaults } from '../rules/ruleSettings.js';
import { GENERAL_RULES } from '../generalRules/index.js';
import { Horizon } from '../tradeEnums.js';

/** A position whose price has moved `gain` ₹ per unit in its favour (its best so far `bestGain`); its ₹ P&L as for 75 units. */
const position = (gain, horizon = Horizon.Intraday, bestGain = gain) => ({ instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon, gain, bestGain, pnl: gain * 75 });
const at = (iso, todayAutoPnl = 0) => ({ now: new Date(iso), todayAutoPnl });
const noon = at('2026-11-05T06:30:00Z'); // Thu 12:00 IST

/** All of a list's rules inactive, except those given here (active, with these values). */
const activate = (list, active) => {
  const rules = defaultRuleSettings(list);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};
const settings = (strategy = {}, general = {}) => ({ strategy: activate(EXIT_RULES, strategy), general: activate(GENERAL_RULES, general) });

const check = (id, params, pos = position(0), ctx = noon) => EXIT_RULES.find((r) => r.id === id).check(pos, ctx, params);

describe('the exit rule list', () => {
  it("is a strategy's own: stop-loss, target and square off", () => {
    expect(EXIT_RULES.map((r) => r.id)).toEqual(['stop-loss', 'target', 'square-off']);
  });

  it('turns off a stop-loss or target saved in percent, before they took rupees, until rupee amounts are set', () => {
    const stored = { 'stop-loss': { active: true, params: { percent: 12 } }, target: { active: true, params: { percent: 12, trailPercent: 1 } } };
    expect(ruleSettingsWithDefaults(EXIT_RULES, stored)).toMatchObject({
      'stop-loss': { active: false, params: { points: null } },
      target: { active: false, params: { points: null, trailPoints: null } },
    });
  });

  it('starts every rule inactive; only square off has a time filled in, the 15:00 asked for', () => {
    expect(defaultRuleSettings(EXIT_RULES)).toEqual({
      'stop-loss': { active: false, params: { points: null } },
      target: { active: false, params: { points: null, trailPoints: null } },
      'square-off': { active: false, params: { time: '15:00' } },
    });
  });
});

describe('stop-loss', () => {
  it('exits once the price has moved the rupees against the position from its entry, not before', () => {
    expect(check('stop-loss', { points: 20 }, position(-19.95))).toBeNull();
    expect(check('stop-loss', { points: 20 }, position(5))).toBeNull();
    expect(check('stop-loss', { points: 20 }, position(-20))).toBe('Stop-loss hit (₹20)');
    expect(check('stop-loss', { points: 20 }, position(-150))).toBe('Stop-loss hit (₹20)');
  });
});

describe('target', () => {
  it("exits once the price has moved the rupees in the position's favour from its entry, not before", () => {
    expect(check('target', { points: 40 }, position(39.95))).toBeNull();
    expect(check('target', { points: 40 }, position(-10))).toBeNull();
    expect(check('target', { points: 40 }, position(40))).toBe('Target hit (₹40)');
  });

  describe('with Trail by: bought at ₹100, stop-loss ₹10, target ₹15, trail ₹2', () => {
    const rules = settings({ 'stop-loss': { points: 10 }, target: { points: 15, trailPoints: 2 } });
    /** The position at `price`, its best price so far `best`. */
    const at = (price, best = price) => checkExitRules(position(price - 100, Horizon.Intraday, best - 100), noon, rules);

    it('leaves the stop-loss as the stop until the target is reached: exits at ₹90', () => {
      expect(at(91, 114.95)).toBeNull();
      expect(at(90, 114.95)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (₹10)' });
    });

    it("doesn't exit at ₹115, where the trailing stop starts at ₹113 and becomes the stop", () => {
      expect(at(115)).toBeNull();
      expect(at(113.05, 115)).toBeNull();
      expect(at(113, 115)).toEqual({ ruleId: 'target', reason: 'Trailing stop-loss hit (best +₹15, trail ₹2, target ₹15)' });
    });

    it('shows a best price that came with floating-point error to the paisa', () => {
      expect(at(113.1, 115.15)).toEqual({ ruleId: 'target', reason: 'Trailing stop-loss hit (best +₹15.15, trail ₹2, target ₹15)' });
    });

    it('raises the stop with each new best price: ₹114 at ₹116, ₹118 at ₹120', () => {
      expect(at(114.05, 116)).toBeNull();
      expect(at(114, 116)).toEqual({ ruleId: 'target', reason: 'Trailing stop-loss hit (best +₹16, trail ₹2, target ₹15)' });
      expect(at(118, 120)).toEqual({ ruleId: 'target', reason: 'Trailing stop-loss hit (best +₹20, trail ₹2, target ₹15)' });
    });
  });
});

describe('square-off', () => {
  it('exits from the time (IST) onwards, not before', () => {
    expect(check('square-off', { time: '15:00' }, position(0), at('2026-11-05T09:29:00Z'))).toBeNull(); // 14:59 IST
    expect(check('square-off', { time: '15:00' }, position(0), at('2026-11-05T09:30:00Z'))).toBe('Squared off at 15:00 IST'); // 15:00 IST
    expect(check('square-off', { time: '15:00' }, position(0), at('2026-11-05T09:45:00Z'))).toBe('Squared off at 15:00 IST'); // 15:15 IST
  });

  it('leaves a positional position open, since it is held over days', () => {
    expect(check('square-off', { time: '15:00' }, position(0, Horizon.Positional), at('2026-11-05T09:45:00Z'))).toBeNull(); // 15:15 IST
  });
});

describe('checkExitRules', () => {
  it('keeps every position open while every rule is inactive', () => {
    expect(checkExitRules(position(-1e9), at('2026-11-05T10:00:00Z', -1e9), settings())).toBeNull();
  });

  it('exits with the first active rule that fires, in list order', () => {
    const rules = settings({ 'stop-loss': { points: 10 }, 'square-off': { time: '11:00' } });
    expect(checkExitRules(position(-20), noon, rules)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (₹10)' });
    expect(checkExitRules(position(2), noon, rules)).toEqual({ ruleId: 'square-off', reason: 'Squared off at 11:00 IST' });
  });

  it("checks the strategy's rules first, then the account's general ones", () => {
    const rules = settings({ 'stop-loss': { points: 10 } }, { 'max-daily-loss': { amount: 5000 } });
    const lossDay = at('2026-11-05T06:30:00Z', -6000); // Thu 12:00 IST
    expect(checkExitRules(position(-20), lossDay, rules)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (₹10)' });
    expect(checkExitRules(position(5), lossDay, rules))
      .toEqual({ ruleId: 'max-daily-loss', reason: "Max loss per day hit: today's automated P&L ₹-6000.00, limit ₹5000" });
  });

  it('keeps a position open when no active rule fires', () => {
    const rules = settings({ 'stop-loss': { points: 10 }, target: { points: 20 }, 'square-off': { time: '15:00' } }, { 'max-daily-loss': { amount: 5000 } });
    expect(checkExitRules(position(5), noon, rules)).toBeNull();
  });
});

describe('checkEntryOrderBlocked', () => {
  const order = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon: Horizon.Intraday };

  it('blocks entry orders only by a rule that says so, not by a stop-loss or target', () => {
    const rules = settings({ 'stop-loss': { points: 0 }, target: { points: 0 }, 'square-off': { time: '15:00' } }, { 'max-daily-loss': { amount: 5000 } });
    expect(checkEntryOrderBlocked(order, noon, rules)).toBeNull();
  });

  it("is blocked by the strategy's square-off from its time, then by the general max loss per day", () => {
    const rules = settings({ 'square-off': { time: '11:00' } }, { 'max-daily-loss': { amount: 5000 } });
    expect(checkEntryOrderBlocked(order, at('2026-11-05T06:30:00Z', -5000), rules)) // Thu 12:00 IST
      .toEqual({ ruleId: 'square-off', reason: 'Squared off at 11:00 IST' });
    expect(checkEntryOrderBlocked(order, at('2026-11-05T05:00:00Z', -5000), rules)) // Thu 10:30 IST
      .toEqual({ ruleId: 'max-daily-loss', reason: "Max loss per day hit: today's automated P&L ₹-5000.00, limit ₹5000" });
  });
});

describe('exitLabel', () => {
  it("names a strategy's rule, a general rule and the engine's own exit, and gives an unknown id back", () => {
    expect(exitLabel('stop-loss')).toBe('Stop-loss');
    expect(exitLabel('max-daily-loss')).toBe('Max loss per day');
    expect(exitLabel('session-square-off')).toBe('Session square-off');
    expect(exitLabel('gone-rule')).toBe('gone-rule');
  });
});
