import { describe, it, expect } from 'vitest';
import { EXIT_RULES, checkExitRules } from './index.js';
import { defaultRuleSettings } from '../rules/ruleSettings.js';

const position = (pnl) => ({ instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', pnl });
const at = (iso) => ({ now: new Date(iso) });
const noon = at('2026-11-05T06:30:00Z'); // Thu 12:00 IST

/** All rules inactive, except those given here (active, with these values). */
const settings = (active = {}) => {
  const rules = defaultRuleSettings(EXIT_RULES);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};

const check = (id, params, pos = position(0), ctx = noon) => EXIT_RULES.find((r) => r.id === id).check(pos, ctx, params);

describe('the exit rule list', () => {
  it('is stop-loss, target and square off', () => {
    expect(EXIT_RULES.map((r) => r.id)).toEqual(['stop-loss', 'target', 'square-off']);
  });

  it('starts every rule inactive; only square off has a time filled in, the 15:00 asked for', () => {
    expect(defaultRuleSettings(EXIT_RULES)).toEqual({
      'stop-loss': { active: false, params: { amount: null } },
      target: { active: false, params: { amount: null } },
      'square-off': { active: false, params: { time: '15:00' } },
    });
  });
});

describe('stop-loss', () => {
  it("exits once the position's loss reaches the amount, not before", () => {
    expect(check('stop-loss', { amount: 2000 }, position(-1999.99))).toBeNull();
    expect(check('stop-loss', { amount: 2000 }, position(500))).toBeNull();
    expect(check('stop-loss', { amount: 2000 }, position(-2000))).toBe('Stop-loss hit: P&L ₹-2000.00, stop-loss ₹2000');
    expect(check('stop-loss', { amount: 2000 }, position(-2500.5))).toBe('Stop-loss hit: P&L ₹-2500.50, stop-loss ₹2000');
  });
});

describe('target', () => {
  it("exits once the position's profit reaches the amount, not before", () => {
    expect(check('target', { amount: 3000 }, position(2999.99))).toBeNull();
    expect(check('target', { amount: 3000 }, position(-100))).toBeNull();
    expect(check('target', { amount: 3000 }, position(3000))).toBe('Target hit: P&L ₹3000.00, target ₹3000');
  });
});

describe('square-off', () => {
  it('exits from the time (IST) onwards, not before', () => {
    expect(check('square-off', { time: '15:00' }, position(0), at('2026-11-05T09:29:00Z'))).toBeNull(); // 14:59 IST
    expect(check('square-off', { time: '15:00' }, position(0), at('2026-11-05T09:30:00Z'))).toBe('Squared off at 15:00 IST'); // 15:00 IST
    expect(check('square-off', { time: '15:00' }, position(0), at('2026-11-05T09:45:00Z'))).toBe('Squared off at 15:00 IST'); // 15:15 IST
  });
});

describe('checkExitRules', () => {
  it('keeps every position open while every rule is inactive', () => {
    expect(checkExitRules(position(-1e9), at('2026-11-05T10:00:00Z'), defaultRuleSettings(EXIT_RULES))).toBeNull();
  });

  it('exits with the first active rule that fires, in list order', () => {
    const rules = settings({ 'stop-loss': { amount: 1000 }, 'square-off': { time: '11:00' } });
    expect(checkExitRules(position(-1500), noon, rules)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit: P&L ₹-1500.00, stop-loss ₹1000' });
    expect(checkExitRules(position(200), noon, rules)).toEqual({ ruleId: 'square-off', reason: 'Squared off at 11:00 IST' });
  });

  it('keeps a position open when no active rule fires', () => {
    const rules = settings({ 'stop-loss': { amount: 1000 }, target: { amount: 2000 }, 'square-off': { time: '15:00' } });
    expect(checkExitRules(position(500), noon, rules)).toBeNull();
  });
});
