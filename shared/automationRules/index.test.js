import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_RULES,
  defaultRuleSettings,
  parseRuleSettings,
  ruleSettingsWithDefaults,
  validateAutoTrade,
} from './index.js';
import { PARAM_TYPES } from './paramTypes.js';

// 3 lots of 75.
const trade = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', side: 'SELL', quantity: 225, lotSize: 75 };
const ctx = (extra = {}) => ({ openAutoPositions: [], todayAutoPnl: 0, ...extra });

/** All rules inactive, except those given here (active, with these values). */
const settings = (active = {}) => {
  const rules = defaultRuleSettings();
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};

const check = (id, params, extraCtx = {}, t = trade) =>
  AUTOMATION_RULES.find((r) => r.id === id).check(t, ctx(extraCtx), params);

describe('the rule list', () => {
  it('has unique ids, and every value is of a known kind', () => {
    const ids = AUTOMATION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of AUTOMATION_RULES) {
      for (const param of rule.params) expect(PARAM_TYPES[param.type]).toBeDefined();
    }
  });

  it('is max lots, max open positions, one position per instrument and max loss per day', () => {
    expect(AUTOMATION_RULES.map((r) => r.id)).toEqual(['max-lots', 'max-open-positions', 'one-trade-per-instrument', 'max-daily-loss']);
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

describe('validateAutoTrade', () => {
  it('passes everything while every rule is inactive', () => {
    expect(validateAutoTrade(trade, ctx({ todayAutoPnl: -1e9 }), defaultRuleSettings())).toEqual({ ok: true });
  });

  it('ignores an inactive rule even when its values would reject', () => {
    const rules = defaultRuleSettings();
    rules['max-lots'] = { active: false, params: { max: 1 } };
    expect(validateAutoTrade(trade, ctx(), rules)).toEqual({ ok: true });
  });

  it('rejects with the first active rule that refuses, in list order', () => {
    const verdict = validateAutoTrade(trade, ctx({ todayAutoPnl: -100 }), settings({ 'max-daily-loss': { amount: 50 }, 'max-lots': { max: 1 } }));
    expect(verdict).toEqual({ ok: false, ruleId: 'max-lots', reason: '3 lots is above the 1 allowed per trade' });
  });

  it('passes when every active rule passes', () => {
    expect(validateAutoTrade(trade, ctx(), settings({ 'max-lots': { max: 5 }, 'max-daily-loss': { amount: 1000 } }))).toEqual({ ok: true });
  });
});

describe('defaultRuleSettings', () => {
  it('has every rule inactive with no values, so nothing is limited until the user sets it', () => {
    const rules = defaultRuleSettings();
    expect(Object.keys(rules)).toEqual(AUTOMATION_RULES.map((r) => r.id));
    expect(rules['max-lots']).toEqual({ active: false, params: { max: null } });
    expect(rules['one-trade-per-instrument']).toEqual({ active: false, params: {} });
  });
});

describe('parseRuleSettings', () => {
  it('accepts active rules with their values, and inactive ones with or without values', () => {
    const input = settings({ 'max-lots': { max: 2 }, 'max-daily-loss': { amount: 2500.5 } });
    input['max-open-positions'] = { active: false, params: { max: 3 } };
    expect(parseRuleSettings(input)).toEqual({ rules: input });
  });

  it('refuses an active rule with a value missing, instead of guessing one', () => {
    expect(parseRuleSettings(settings({ 'max-lots': { max: null } })))
      .toEqual({ error: 'Max lots per trade: set Lots to make it active' });
  });

  it('refuses values of the wrong kind, active or not, without rewriting them', () => {
    expect(parseRuleSettings(settings({ 'max-lots': { max: 1.5 } })))
      .toEqual({ error: 'Max lots per trade: Lots must be a whole number above 0' });
    expect(parseRuleSettings(settings({ 'max-daily-loss': { amount: -10 } })))
      .toEqual({ error: 'Max loss per day: Loss (₹) must be an amount above 0' });
    const inactive = defaultRuleSettings();
    inactive['max-open-positions'] = { active: false, params: { max: 0 } };
    expect(parseRuleSettings(inactive)).toEqual({ error: 'Max open automated positions: Positions must be a whole number above 0' });
  });

  it('refuses missing or unknown rules', () => {
    expect(parseRuleSettings(undefined)).toEqual({ error: 'rules is required' });
    const missing = defaultRuleSettings();
    delete missing['max-lots'];
    expect(parseRuleSettings(missing)).toEqual({ error: 'rules.max-lots is required' });
    expect(parseRuleSettings({ ...defaultRuleSettings(), 'no-fridays': { active: true, params: {} } }))
      .toEqual({ error: 'unknown rule: no-fridays' });
  });

  it('refuses an active flag that is not true or false', () => {
    const rules = defaultRuleSettings();
    rules['max-lots'] = { active: 'yes', params: { max: 1 } };
    expect(parseRuleSettings(rules)).toEqual({ error: 'Max lots per trade: active must be true or false' });
  });
});

describe('ruleSettingsWithDefaults', () => {
  it('keeps stored rules, brings in rules added since as inactive, and drops removed ones', () => {
    const stored = { 'max-lots': { active: true, params: { max: 2 } }, 'max-quantity': { active: true, params: { max: 75 } } };
    const rules = ruleSettingsWithDefaults(stored);
    expect(rules['max-lots']).toEqual({ active: true, params: { max: 2 } });
    expect(rules['max-daily-loss']).toEqual({ active: false, params: { amount: null } });
    expect(rules).not.toHaveProperty('max-quantity');
  });

  it('gives the defaults when nothing is stored (configs saved before rules existed)', () => {
    expect(ruleSettingsWithDefaults(undefined)).toEqual(defaultRuleSettings());
  });
});
