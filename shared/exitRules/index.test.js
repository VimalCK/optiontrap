import { describe, it, expect } from 'vitest';
import { EXIT_RULES, checkExitRules } from './index.js';
import { defaultRuleSettings } from '../rules/ruleSettings.js';
import { Horizon } from '../horizons.js';

/** A position at a P&L percentage; its ₹ P&L as for 75 units sold at 100, i.e. 75 × the percentage. */
const position = (pnlPercent, horizon = Horizon.Intraday) => ({ instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', horizon, pnlPercent, pnl: pnlPercent * 75 });
const at = (iso, todayAutoPnl = 0) => ({ now: new Date(iso), todayAutoPnl });
const noon = at('2026-11-05T06:30:00Z'); // Thu 12:00 IST

/** All rules inactive, except those given here (active, with these values). */
const settings = (active = {}) => {
  const rules = defaultRuleSettings(EXIT_RULES);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};

const check = (id, params, pos = position(0), ctx = noon) => EXIT_RULES.find((r) => r.id === id).check(pos, ctx, params);

describe('the exit rule list', () => {
  it('is stop-loss, target, square off and max loss per day', () => {
    expect(EXIT_RULES.map((r) => r.id)).toEqual(['stop-loss', 'target', 'square-off', 'max-daily-loss']);
  });

  it('starts every rule inactive; only square off has a time filled in, the 15:00 asked for', () => {
    expect(defaultRuleSettings(EXIT_RULES)).toEqual({
      'stop-loss': { active: false, params: { percent: null } },
      target: { active: false, params: { percent: null } },
      'square-off': { active: false, params: { time: '15:00' } },
      'max-daily-loss': { active: false, params: { amount: null } },
    });
  });
});

describe('max-daily-loss', () => {
  const NOON_ISO = '2026-11-05T06:30:00Z'; // Thu 12:00 IST

  it("exits once today's automated P&L reaches the loss, not before", () => {
    expect(check('max-daily-loss', { amount: 5000 }, position(0), at(NOON_ISO, -4999.99))).toBeNull();
    expect(check('max-daily-loss', { amount: 5000 }, position(0), at(NOON_ISO, 2000))).toBeNull();
    expect(check('max-daily-loss', { amount: 5000 }, position(0), at(NOON_ISO, -5000)))
      .toBe("Max loss per day hit: today's automated P&L ₹-5000.00, limit ₹5000");
  });

  it('exits a winning position too, since the limit is on the whole day', () => {
    expect(check('max-daily-loss', { amount: 5000 }, position(30), at(NOON_ISO, -5500))).not.toBeNull();
  });
});

describe('stop-loss', () => {
  it("exits once the position's loss reaches the percentage of its entry price, not before", () => {
    expect(check('stop-loss', { percent: 20 }, position(-19.99))).toBeNull();
    expect(check('stop-loss', { percent: 20 }, position(5))).toBeNull();
    expect(check('stop-loss', { percent: 20 }, position(-20))).toBe('Stop-loss hit: P&L -20.00% (₹-1500.00), stop-loss 20%');
    expect(check('stop-loss', { percent: 20 }, position(-150))).toBe('Stop-loss hit: P&L -150.00% (₹-11250.00), stop-loss 20%');
  });
});

describe('target', () => {
  it("exits once the position's profit reaches the percentage of its entry price, not before", () => {
    expect(check('target', { percent: 40 }, position(39.99))).toBeNull();
    expect(check('target', { percent: 40 }, position(-10))).toBeNull();
    expect(check('target', { percent: 40 }, position(40))).toBe('Target hit: P&L 40.00% (₹3000.00), target 40%');
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
    expect(checkExitRules(position(-1e9), at('2026-11-05T10:00:00Z'), defaultRuleSettings(EXIT_RULES))).toBeNull();
  });

  it('exits with the first active rule that fires, in list order', () => {
    const rules = settings({ 'stop-loss': { percent: 10 }, 'square-off': { time: '11:00' } });
    expect(checkExitRules(position(-20), noon, rules)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit: P&L -20.00% (₹-1500.00), stop-loss 10%' });
    expect(checkExitRules(position(2), noon, rules)).toEqual({ ruleId: 'square-off', reason: 'Squared off at 11:00 IST' });
  });

  it('keeps a position open when no active rule fires', () => {
    const rules = settings({ 'stop-loss': { percent: 10 }, target: { percent: 20 }, 'square-off': { time: '15:00' } });
    expect(checkExitRules(position(5), noon, rules)).toBeNull();
  });
});
