import { describe, it, expect } from 'vitest';
import { DEFAULT_TRADE_LOTS, ENTRY_RULES, checkEntryRules, entryLimitPrice, entryRuleContexts, tradeLots } from './index.js';
import { defaultRuleSettings, parseRuleSettings, ruleSettingsWithDefaults } from '../rules/ruleSettings.js';
import { GENERAL_RULES } from '../generalRules/index.js';
import { PARAM_TYPES } from '../rules/paramTypes.js';

// 3 lots of 75.
const trade = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', side: 'SELL', quantity: 225, lotSize: 75 };
const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const ctx = (extra = {}) => ({ now: NOON, openAutoPositions: [], waitingAutoOrders: [], todayAutoPnl: 0, todayAutoExits: [], ...extra });

/** All rules inactive, except those given here (active, with these values). */
const settings = (active = {}) => {
  const rules = defaultRuleSettings(ENTRY_RULES);
  for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
  return rules;
};

const check = (id, params, extraCtx = {}, t = trade) =>
  ENTRY_RULES.find((r) => r.id === id).check(t, ctx(extraCtx), params);

describe('the entry rule list', () => {
  it("is a strategy's own: max lots, wait after exit, one position per instrument and entry limit offset", () => {
    expect(ENTRY_RULES.map((r) => r.id)).toEqual(['max-lots', 'wait-after-exit', 'one-trade-per-instrument', 'entry-limit-offset']);
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

describe('one-trade-per-instrument', () => {
  it('rejects a trade in an instrument with an open automated position', () => {
    expect(check('one-trade-per-instrument', {}, { openAutoPositions: [{ instrumentToken: 5 }] })).toBeNull();
    expect(check('one-trade-per-instrument', {}, { openAutoPositions: [{ instrumentToken: 101 }] }))
      .toBe('An automated position in NIFTY26NOV24000PE is already open');
  });

  it('rejects a trade in an instrument with an automated limit order still waiting', () => {
    expect(check('one-trade-per-instrument', {}, { waitingAutoOrders: [{ instrumentToken: 101 }] }))
      .toBe('An automated limit order in NIFTY26NOV24000PE is already waiting');
  });
});

describe('entry-limit-offset', () => {
  const offset = (points, active = true) => settings(active ? { 'entry-limit-offset': { points } } : {});

  it('never refuses a trade: it only prices the entry', () => {
    expect(check('entry-limit-offset', { points: 12 })).toBeNull();
  });

  it('prices a buy that many rupees below the last price and a sell that many above it', () => {
    expect(entryLimitPrice(offset(12), 'BUY', 60)).toBe(48);
    expect(entryLimitPrice(offset(12), 'SELL', 60)).toBe(72);
    expect(entryLimitPrice(offset(3), 'BUY', 100)).toBe(97);
  });

  it('rounds to the 0.05 tick in the trade’s favour: a buy down, a sell up', () => {
    expect(entryLimitPrice(offset(12.34), 'BUY', 123.45)).toBe(111.1); // 111.11 → 111.10
    expect(entryLimitPrice(offset(12.34), 'SELL', 123.45)).toBe(135.8); // 135.79 → 135.80
  });

  it('is null while the rule is off: the engine enters at the last price', () => {
    expect(entryLimitPrice(offset(12, false), 'BUY', 60)).toBeNull();
  });

  it('turns off an offset saved in percent, before it took rupees, until a rupee amount is set', () => {
    const stored = { 'entry-limit-offset': { active: true, params: { percent: 3 } } };
    expect(ruleSettingsWithDefaults(ENTRY_RULES, stored)['entry-limit-offset']).toEqual({ active: false, params: { points: null } });
  });
});

describe('wait-after-exit', () => {
  const exitedAt = (minutesBeforeNoon, instrumentToken = 101) => ({ todayAutoExits: [{ instrumentToken, exitTime: new Date(NOON.getTime() - minutesBeforeNoon * 60_000) }] });

  it('refuses the same instrument until the minutes have passed since its last exit', () => {
    expect(check('wait-after-exit', { minutes: 15 }, exitedAt(10)))
      .toBe('NIFTY26NOV24000PE was exited at 11:50 IST; waiting until 12:05 IST');
    expect(check('wait-after-exit', { minutes: 15 }, exitedAt(15))).toBeNull();
    expect(check('wait-after-exit', { minutes: 15 }, exitedAt(40))).toBeNull();
  });

  it('lets in an instrument not exited today, even straight after another was', () => {
    expect(check('wait-after-exit', { minutes: 15 })).toBeNull();
    expect(check('wait-after-exit', { minutes: 15 }, exitedAt(1, 202))).toBeNull();
  });
});

describe('entryRuleContexts', () => {
  it("keeps the account's facts for the general rules and gives the strategy only its own, with the account's P&L", () => {
    const exitTime = new Date(NOON.getTime() - 60_000);
    const account = ctx({
      openAutoPositions: [{ instrumentToken: 1, strategyId: 'a' }, { instrumentToken: 2, strategyId: 'b' }],
      waitingAutoOrders: [{ instrumentToken: 3, strategyId: 'b' }],
      todayAutoExits: [{ instrumentToken: 4, strategyId: 'a', exitTime }],
      todayAutoPnl: -500,
    });
    const { account: general, strategy } = entryRuleContexts(account, 'a');
    expect(general).toBe(account);
    expect(strategy).toEqual({
      ...account,
      openAutoPositions: [{ instrumentToken: 1, strategyId: 'a' }],
      waitingAutoOrders: [],
      todayAutoExits: [{ instrumentToken: 4, strategyId: 'a', exitTime }],
      todayAutoPnl: -500,
    });
  });
});

describe('checkEntryRules', () => {
  const contexts = (account = {}, strategy = {}) => ({ account: ctx(account), strategy: ctx(strategy) });
  const general = (active = {}) => {
    const rules = defaultRuleSettings(GENERAL_RULES);
    for (const [id, params] of Object.entries(active)) rules[id] = { active: true, params };
    return rules;
  };

  it('passes everything while every rule is inactive', () => {
    expect(checkEntryRules(trade, contexts({ todayAutoPnl: -1e9 }), { general: general(), strategy: settings() })).toEqual({ ok: true });
  });

  it("checks the account's general rules first, then the strategy's, each in list order", () => {
    const verdict = checkEntryRules(trade, contexts({ openAutoPositions: [{ instrumentToken: 1 }] }), {
      general: general({ 'max-open-positions': { max: 1 } }),
      strategy: settings({ 'max-lots': { max: 1 } }),
    });
    expect(verdict).toEqual({ ok: false, ruleId: 'max-open-positions', reason: '1 automated positions already open or waiting to fill, the most allowed is 1' });
    expect(checkEntryRules(trade, contexts(), { general: general({ 'max-open-positions': { max: 1 } }), strategy: settings({ 'max-lots': { max: 1 } }) }))
      .toEqual({ ok: false, ruleId: 'max-lots', reason: '3 lots is above the 1 allowed per trade' });
  });

  it("gives the general rules every strategy's facts and the strategy's rules only its own", () => {
    const heldByAnother = { openAutoPositions: [{ instrumentToken: 101 }] };
    const rules = { general: general(), strategy: settings({ 'one-trade-per-instrument': {} }) };
    expect(checkEntryRules(trade, contexts(heldByAnother, {}), rules)).toEqual({ ok: true });
    expect(checkEntryRules(trade, contexts(heldByAnother, heldByAnother), rules))
      .toEqual({ ok: false, ruleId: 'one-trade-per-instrument', reason: 'An automated position in NIFTY26NOV24000PE is already open' });
  });

  it('passes when every active rule passes', () => {
    expect(checkEntryRules(trade, contexts(), { general: general({ 'max-open-positions': { max: 5 } }), strategy: settings({ 'max-lots': { max: 5 } }) }))
      .toEqual({ ok: true });
  });
});

describe('entry rule settings', () => {
  it('refuses an active rule with a value missing, naming the rule', () => {
    expect(parseRuleSettings(ENTRY_RULES, settings({ 'max-lots': { max: null } }), 'entryRules'))
      .toEqual({ error: 'Max lots per trade: set Lots to make it active' });
  });
});
