import { describe, it, expect } from 'vitest';
import { DEFAULT_TRADE_LOTS, ENTRY_RULES, checkEntryRules, tradeLots } from './index.js';
import { defaultRuleSettings, parseRuleSettings } from '../rules/ruleSettings.js';
import { PARAM_TYPES } from '../rules/paramTypes.js';

// 3 lots of 75.
const trade = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', side: 'SELL', quantity: 225, lotSize: 75 };
const ctx = (extra = {}) => ({ openAutoPositions: [], todayAutoPnl: 0, ...extra });

/** All rules inactive, except those given here (active, with these values). */
const settings = (active = {}) => {
  const rules = defaultRuleSettings(ENTRY_RULES);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};

const check = (id, params, extraCtx = {}, t = trade) =>
  ENTRY_RULES.find((r) => r.id === id).check(t, ctx(extraCtx), params);

describe('the entry rule list', () => {
  it('is max lots, max open positions, one position per instrument and max loss per day', () => {
    expect(ENTRY_RULES.map((r) => r.id)).toEqual(['max-lots', 'max-open-positions', 'one-trade-per-instrument', 'max-daily-loss']);
  });

  it('has unique ids, every value of a known kind, and no defaults: nothing is limited until the user sets it', () => {
    const ids = ENTRY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of ENTRY_RULES) {
      for (const param of rule.params) {
        expect(PARAM_TYPES[param.type]).toBeDefined();
        expect(param.default).toBeUndefined();
      }
    }
  });
});

describe('max-lots', () => {
  it("counts lots by the instrument's lot size, allowing up to the maximum", () => {
    expect(check('max-lots', { max: 3 })).toBeNull();
    expect(check('max-lots', { max: 2 })).toBe('3 lots is above the 2 allowed per trade');
  });

  it('counts a stock (lot size 1) share by share', () => {
    const stock = { ...trade, quantity: 10, lotSize: 1 };
    expect(check('max-lots', { max: 10 }, {}, stock)).toBeNull();
    expect(check('max-lots', { max: 9 }, {}, stock)).toBe('10 lots is above the 9 allowed per trade');
  });
});

describe('tradeLots', () => {
  it('is the Max lots value while that rule is active', () => {
    expect(tradeLots({ ...defaultRuleSettings(ENTRY_RULES), 'max-lots': { active: true, params: { max: 3 } } })).toBe(3);
  });

  it('is 1 lot while it is off, whatever value it holds', () => {
    expect(DEFAULT_TRADE_LOTS).toBe(1);
    expect(tradeLots({ ...defaultRuleSettings(ENTRY_RULES), 'max-lots': { active: false, params: { max: 3 } } })).toBe(1);
    expect(tradeLots(defaultRuleSettings(ENTRY_RULES))).toBe(1);
  });
});

describe('max-open-positions', () => {
  const open = [{ instrumentToken: 1 }, { instrumentToken: 2 }];

  it('rejects a trade that would open one position too many', () => {
    expect(check('max-open-positions', { max: 3 }, { openAutoPositions: open })).toBeNull();
    expect(check('max-open-positions', { max: 2 }, { openAutoPositions: open }))
      .toBe('2 automated positions already open, the most allowed is 2');
  });

  it('allows a trade that merges into a position already open', () => {
    expect(check('max-open-positions', { max: 2 }, { openAutoPositions: open }, { ...trade, instrumentToken: 2 })).toBeNull();
  });
});

describe('one-trade-per-instrument', () => {
  it('rejects a trade in an instrument with an open automated position', () => {
    expect(check('one-trade-per-instrument', {}, { openAutoPositions: [{ instrumentToken: 5 }] })).toBeNull();
    expect(check('one-trade-per-instrument', {}, { openAutoPositions: [{ instrumentToken: 101 }] }))
      .toBe('An automated position in NIFTY26NOV24000PE is already open');
  });
});

describe('max-daily-loss', () => {
  it("rejects once today's loss reaches the amount", () => {
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: -4999.99 })).toBeNull();
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: 2000 })).toBeNull();
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: -5000 }))
      .toBe("Today's automated loss ₹5000.00 has reached the ₹5000 limit");
  });
});

describe('checkEntryRules', () => {
  it('passes everything while every rule is inactive', () => {
    expect(checkEntryRules(trade, ctx({ todayAutoPnl: -1e9 }), defaultRuleSettings(ENTRY_RULES))).toEqual({ ok: true });
  });

  it('rejects with the first active rule that refuses, in list order', () => {
    const verdict = checkEntryRules(trade, ctx({ todayAutoPnl: -100 }), settings({ 'max-daily-loss': { amount: 50 }, 'max-lots': { max: 1 } }));
    expect(verdict).toEqual({ ok: false, ruleId: 'max-lots', reason: '3 lots is above the 1 allowed per trade' });
  });

  it('passes when every active rule passes', () => {
    expect(checkEntryRules(trade, ctx(), settings({ 'max-lots': { max: 5 }, 'max-daily-loss': { amount: 1000 } }))).toEqual({ ok: true });
  });
});

describe('entry rule settings', () => {
  it('refuses an active rule with a value missing, naming the rule', () => {
    expect(parseRuleSettings(ENTRY_RULES, settings({ 'max-lots': { max: null } }), 'entryRules'))
      .toEqual({ error: 'Max lots per trade: set Lots to make it active' });
  });
});
