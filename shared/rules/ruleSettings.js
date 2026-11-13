/**
 * Shared by the entry and exit rule lists: the shape of a rule, and the
 * user's settings for each rule.
 *
 * A rule is { id, label, description, params, check }:
 *   id           stable name, the key of its setting in the user's config
 *   label        what the settings page calls it
 *   description  one line on what it does
 *   params       the values the user sets for it: { key, label, type, default?, hideLabel? }
 *                (types in paramTypes.js; default only when the user has named one;
 *                hideLabel when the rule's own name already says what the value is, so
 *                the label is only the input's accessible name and appears in messages)
 *   check(subject, ctx, params)  null to let it pass, or the reason it fires
 */
import { PARAM_TYPES } from './paramTypes.js';

/**
 * @typedef {import('./paramTypes.js').ParamTypeId} ParamTypeId
 * @typedef {number | string | null} ParamValue
 * @typedef {{ key: string, label: string, type: ParamTypeId, default?: number | string, hideLabel?: boolean }} RuleParam
 * @typedef {{ active: boolean, params: Record<string, ParamValue> }} RuleSetting
 * @typedef {Record<string, RuleSetting>} RuleSettings
 * @typedef {{ id: string, label: string, description: string, params: RuleParam[] }} RuleInfo
 */

/**
 * @template S, C
 * @typedef {RuleInfo & { check: (subject: S, ctx: C, params: Record<string, any>) => string | null }} Rule
 */

/** @param {RuleInfo} rule @returns {RuleSetting} */
const inactive = (rule) => ({ active: false, params: Object.fromEntries(rule.params.map((p) => [p.key, p.default ?? null])) });

/**
 * @param {RuleInfo[]} rules
 * @returns {RuleSettings}
 */
export function defaultRuleSettings(rules) {
  return Object.fromEntries(rules.map((rule) => [rule.id, inactive(rule)]));
}

/**
 * Check one rule's setting from the client. An active rule needs every value;
 * an inactive one may leave values empty, but what it has must be valid.
 * @param {RuleInfo} rule
 * @param {any} input
 * @param {string} field  where the settings sit in the config, for messages
 * @returns {{ setting: RuleSetting, error?: undefined } | { error: string, setting?: undefined }}
 */
function parseRuleSetting(rule, input, field) {
  if (!input || typeof input !== 'object') return { error: `${field}.${rule.id} is required` };
  if (typeof input.active !== 'boolean') return { error: `${rule.label}: active must be true or false` };
  /** @type {Record<string, ParamValue>} */
  const params = {};
  for (const param of rule.params) {
    const raw = input.params?.[param.key];
    const type = PARAM_TYPES[param.type];
    if (raw === null || raw === undefined || raw === '') {
      if (input.active) return { error: `${rule.label}: set ${param.label} to make it active` };
      params[param.key] = null;
      continue;
    }
    const value = type.parse(raw);
    if (value === undefined) return { error: `${rule.label}: ${param.label} must be ${type.mustBe}` };
    params[param.key] = value;
  }
  return { setting: { active: input.active, params } };
}

/**
 * @param {RuleInfo[]} rules
 * @param {any} input
 * @param {string} field  where the settings sit in the config, e.g. 'entryRules'
 * @returns {{ settings: RuleSettings, error?: undefined } | { error: string, settings?: undefined }}
 */
export function parseRuleSettings(rules, input, field) {
  if (!input || typeof input !== 'object') return { error: `${field} is required` };
  const unknown = Object.keys(input).filter((id) => !rules.some((rule) => rule.id === id));
  if (unknown.length) return { error: `unknown rule in ${field}: ${unknown.join(', ')}` };
  /** @type {RuleSettings} */
  const settings = {};
  for (const rule of rules) {
    const { setting, error } = parseRuleSetting(rule, input[rule.id], field);
    if (error !== undefined) return { error };
    settings[rule.id] = setting;
  }
  return { settings };
}

/**
 * Stored settings brought up to date: rules added since they were saved come
 * in inactive, and rules that no longer exist are dropped.
 * @param {RuleInfo[]} rules
 * @param {any} stored
 * @returns {RuleSettings}
 */
export function ruleSettingsWithDefaults(rules, stored) {
  const settings = defaultRuleSettings(rules);
  if (!stored || typeof stored !== 'object') return settings;
  for (const rule of rules) {
    const { setting } = parseRuleSetting(rule, stored[rule.id], '');
    if (setting) settings[rule.id] = setting;
  }
  return settings;
}

/**
 * The first active rule in list order that fires gives its id and reason.
 * @template S, C
 * @param {Rule<S, C>[]} rules
 * @param {S} subject
 * @param {C} ctx
 * @param {RuleSettings} settings
 * @returns {{ ruleId: string, reason: string } | null}
 */
export function firstRuleThatFires(rules, subject, ctx, settings) {
  for (const rule of rules) {
    const setting = settings[rule.id];
    if (!setting?.active) continue;
    const reason = rule.check(subject, ctx, setting.params);
    if (reason) return { ruleId: rule.id, reason };
  }
  return null;
}
