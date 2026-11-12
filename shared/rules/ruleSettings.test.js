import { describe, it, expect } from 'vitest';
import { defaultRuleSettings, firstRuleThatFires, parseRuleSettings, ruleSettingsWithDefaults } from './ruleSettings.js';

// A small list of made-up rules, to test the settings logic on its own.
const RULES = [
  { id: 'max-size', label: 'Max size', description: '', params: [{ key: 'max', label: 'Size', type: 'Count' }], check: (s, _c, { max }) => (s.size > max ? 'too big' : null) },
  { id: 'loss', label: 'Loss', description: '', params: [{ key: 'amount', label: 'Loss (₹)', type: 'Amount' }], check: (s, _c, { amount }) => (s.pnl <= -amount ? 'too much loss' : null) },
  { id: 'cutoff', label: 'Cutoff', description: '', params: [{ key: 'time', label: 'Time', type: 'Time', default: '15:00' }], check: (_s, c, { time }) => (c.time >= time ? 'too late' : null) },
  { id: 'flag', label: 'Flag', description: '', params: [], check: (s) => (s.flagged ? 'flagged' : null) },
];

/** All inactive, except those given here (active, with these values). */
const settings = (active = {}) => {
  const all = defaultRuleSettings(RULES);
  for (const [id, params] of Object.entries(active)) all[id] = { active: true, params };
  return all;
};

describe('defaultRuleSettings', () => {
  it('has every rule inactive with no values, except a default the rule names', () => {
    expect(defaultRuleSettings(RULES)).toEqual({
      'max-size': { active: false, params: { max: null } },
      loss: { active: false, params: { amount: null } },
      cutoff: { active: false, params: { time: '15:00' } },
      flag: { active: false, params: {} },
    });
  });
});

describe('parseRuleSettings', () => {
  it('accepts active rules with their values, and inactive ones with or without values', () => {
    const input = settings({ 'max-size': { max: 2 }, loss: { amount: 2500.5 }, cutoff: { time: '14:30' } });
    input.flag = { active: false, params: {} };
    expect(parseRuleSettings(RULES, input, 'rules')).toEqual({ settings: input });
  });

  it('refuses an active rule with a value missing, instead of guessing one', () => {
    expect(parseRuleSettings(RULES, settings({ 'max-size': { max: null } }), 'rules'))
      .toEqual({ error: 'Max size: set Size to make it active' });
  });

  it('refuses values of the wrong kind, active or not, without rewriting them', () => {
    expect(parseRuleSettings(RULES, settings({ 'max-size': { max: 1.5 } }), 'rules'))
      .toEqual({ error: 'Max size: Size must be a whole number above 0' });
    expect(parseRuleSettings(RULES, settings({ loss: { amount: -10 } }), 'rules'))
      .toEqual({ error: 'Loss: Loss (₹) must be an amount above 0' });
    const inactive = defaultRuleSettings(RULES);
    inactive.cutoff = { active: false, params: { time: '25:00' } };
    expect(parseRuleSettings(RULES, inactive, 'rules')).toEqual({ error: 'Cutoff: Time must be a time as HH:MM' });
    inactive.cutoff = { active: false, params: { time: '3pm' } };
    expect(parseRuleSettings(RULES, inactive, 'rules')).toEqual({ error: 'Cutoff: Time must be a time as HH:MM' });
  });

  it('refuses missing or unknown rules, naming where they belong', () => {
    expect(parseRuleSettings(RULES, undefined, 'exitRules')).toEqual({ error: 'exitRules is required' });
    const missing = defaultRuleSettings(RULES);
    delete missing['max-size'];
    expect(parseRuleSettings(RULES, missing, 'exitRules')).toEqual({ error: 'exitRules.max-size is required' });
    expect(parseRuleSettings(RULES, { ...defaultRuleSettings(RULES), 'no-fridays': { active: true, params: {} } }, 'exitRules'))
      .toEqual({ error: 'unknown rule in exitRules: no-fridays' });
  });

  it('refuses an active flag that is not true or false', () => {
    const input = defaultRuleSettings(RULES);
    input['max-size'] = { active: 'yes', params: { max: 1 } };
    expect(parseRuleSettings(RULES, input, 'rules')).toEqual({ error: 'Max size: active must be true or false' });
  });
});

describe('ruleSettingsWithDefaults', () => {
  it('keeps stored rules, brings in rules added since as inactive, and drops removed ones', () => {
    const stored = { 'max-size': { active: true, params: { max: 2 } }, removed: { active: true, params: {} } };
    const result = ruleSettingsWithDefaults(RULES, stored);
    expect(result['max-size']).toEqual({ active: true, params: { max: 2 } });
    expect(result.cutoff).toEqual({ active: false, params: { time: '15:00' } });
    expect(result).not.toHaveProperty('removed');
  });

  it('keeps a value the user cleared, rather than putting the default back', () => {
    const stored = { cutoff: { active: false, params: { time: null } } };
    expect(ruleSettingsWithDefaults(RULES, stored).cutoff).toEqual({ active: false, params: { time: null } });
  });

  it('gives the defaults when nothing is stored', () => {
    expect(ruleSettingsWithDefaults(RULES, undefined)).toEqual(defaultRuleSettings(RULES));
  });
});

describe('firstRuleThatFires', () => {
  it('ignores inactive rules, even when their values would fire', () => {
    const all = defaultRuleSettings(RULES);
    all['max-size'] = { active: false, params: { max: 1 } };
    expect(firstRuleThatFires(RULES, { size: 5, pnl: 0 }, { time: '10:00' }, all)).toBeNull();
  });

  it('gives the first active rule that fires, in list order', () => {
    const all = settings({ loss: { amount: 100 }, 'max-size': { max: 1 }, flag: {} });
    expect(firstRuleThatFires(RULES, { size: 5, pnl: -500, flagged: true }, { time: '10:00' }, all)).toEqual({ ruleId: 'max-size', reason: 'too big' });
    expect(firstRuleThatFires(RULES, { size: 1, pnl: 0, flagged: true }, { time: '10:00' }, all)).toEqual({ ruleId: 'flag', reason: 'flagged' });
  });
});
