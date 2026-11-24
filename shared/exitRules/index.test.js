import { describe, it, expect } from 'vitest';
import { EXIT_RULES, checkEntryOrderBlocked, checkExitRules, exitLabel } from './index.js';
import { defaultRuleSettings } from '../rules/ruleSettings.js';
import { GENERAL_RULES } from '../generalRules/index.js';
import { Horizon } from '../tradeEnums.js';

/** A position at a P&L percentage; its ₹ P&L as for 75 units sold at 100, i.e. 75 × the percentage. */
const position = (pnlPercent, horizon = Horizon.Intraday) => ({ instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon, pnlPercent, pnl: pnlPercent * 75 });
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

  it('starts every rule inactive; only square off has a time filled in, the 15:00 asked for', () => {
    expect(defaultRuleSettings(EXIT_RULES)).toEqual({
      'stop-loss': { active: false, params: { percent: null } },
      target: { active: false, params: { percent: null, trailPercent: null } },
      'square-off': { active: false, params: { time: '15:00' } },
    });
  });
});

describe('stop-loss', () => {
  it("exits once the position's loss reaches the percentage of its entry price, not before", () => {
    expect(check('stop-loss', { percent: 20 }, position(-19.99))).toBeNull();
    expect(check('stop-loss', { percent: 20 }, position(5))).toBeNull();
    expect(check('stop-loss', { percent: 20 }, position(-20))).toBe('Stop-loss hit (20%)');
    expect(check('stop-loss', { percent: 20 }, position(-150))).toBe('Stop-loss hit (20%)');
  });
});

describe('target', () => {
  it("exits once the position's profit reaches the percentage of its entry price, not before", () => {
    expect(check('target', { percent: 40 }, position(39.99))).toBeNull();
    expect(check('target', { percent: 40 }, position(-10))).toBeNull();
    expect(check('target', { percent: 40 }, position(40))).toBe('Target hit (40%)');
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
    const rules = settings({ 'stop-loss': { percent: 10 }, 'square-off': { time: '11:00' } });
    expect(checkExitRules(position(-20), noon, rules)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (10%)' });
    expect(checkExitRules(position(2), noon, rules)).toEqual({ ruleId: 'square-off', reason: 'Squared off at 11:00 IST' });
  });

  it("checks the strategy's rules first, then the account's general ones", () => {
    const rules = settings({ 'stop-loss': { percent: 10 } }, { 'max-daily-loss': { amount: 5000 } });
    const lossDay = at('2026-11-05T06:30:00Z', -6000); // Thu 12:00 IST
    expect(checkExitRules(position(-20), lossDay, rules)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (10%)' });
    expect(checkExitRules(position(5), lossDay, rules))
      .toEqual({ ruleId: 'max-daily-loss', reason: "Max loss per day hit: today's automated P&L ₹-6000.00, limit ₹5000" });
  });

  it('keeps a position open when no active rule fires', () => {
    const rules = settings({ 'stop-loss': { percent: 10 }, target: { percent: 20 }, 'square-off': { time: '15:00' } }, { 'max-daily-loss': { amount: 5000 } });
    expect(checkExitRules(position(5), noon, rules)).toBeNull();
  });
});

describe('checkEntryOrderBlocked', () => {
  const order = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon: Horizon.Intraday };

  it('blocks entry orders only by a rule that says so, not by a stop-loss or target', () => {
    const rules = settings({ 'stop-loss': { percent: 0 }, target: { percent: 0 }, 'square-off': { time: '15:00' } }, { 'max-daily-loss': { amount: 5000 } });
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
