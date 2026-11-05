/**
 * Automation validation rules: the plug-in list every automated trade is
 * checked against before it is executed (selected → validated or rejected).
 *
 * Each rule is its own file in this folder and describes itself:
 *   id           stable name, the key of its setting in the user's config
 *   label        what the settings page calls it
 *   description  one line on what it rejects
 *   params       the values the user sets for it ({ key, label, type }, types in paramTypes.js)
 *   check(trade, ctx, params)  null when the trade passes, or the reason it's rejected
 *
 * To add a rule, add its file and put it in AUTOMATION_RULES. The settings
 * page, the stored config and the runner pick it up from this list; nothing
 * else changes. A rule only reads `ctx`; a fact a new rule needs is added to
 * RuleContext once, where the engine builds it.
 *
 * Users switch each rule between active and inactive. Rules start inactive
 * with no values, so nothing is limited until the user sets it.
 */
import { PARAM_TYPES } from './paramTypes.js';
import maxLots from './maxLots.js';
import maxOpenPositions from './maxOpenPositions.js';
import oneTradePerInstrument from './oneTradePerInstrument.js';
import maxDailyLoss from './maxDailyLoss.js';

/**
 * @typedef {import('./paramTypes.js').ParamTypeId} ParamTypeId
 * @typedef {{ instrumentToken: number, tradingsymbol: string, side: string, quantity: number, lotSize: number }} CandidateTrade
 * @typedef {{
 *   openAutoPositions: { instrumentToken: number }[],
 *   todayAutoPnl: number,
 * }} RuleContext
 * @typedef {{ key: string, label: string, type: ParamTypeId }} RuleParam
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   params: RuleParam[],
 *   check: (trade: CandidateTrade, ctx: RuleContext, params: Record<string, any>) => string | null,
 * }} AutomationRule
 * @typedef {number | null} ParamValue
 * @typedef {{ active: boolean, params: Record<string, ParamValue> }} RuleSetting
 * @typedef {Record<string, RuleSetting>} RuleSettings
 * @typedef {{ ok: true } | { ok: false, ruleId: string, reason: string }} RuleVerdict
 */

/** Every validation rule, in the order they're checked. @type {AutomationRule[]} */
export const AUTOMATION_RULES = [maxLots, maxOpenPositions, oneTradePerInstrument, maxDailyLoss];

/**
 * Run the user's active rules on a trade; the first that refuses it gives the reason.
 * @param {CandidateTrade} trade
 * @param {RuleContext} ctx
 * @param {RuleSettings} settings
 * @returns {RuleVerdict}
 */
export function validateAutoTrade(trade, ctx, settings) {
  for (const rule of AUTOMATION_RULES) {
    const setting = settings[rule.id];
    if (!setting?.active) continue;
    const reason = rule.check(trade, ctx, setting.params);
    if (reason) return { ok: false, ruleId: rule.id, reason };
  }
  return { ok: true };
}

/** @param {AutomationRule} rule @returns {RuleSetting} */
const inactive = (rule) => ({ active: false, params: Object.fromEntries(rule.params.map((p) => [p.key, null])) });

/**
 * Every rule inactive with no values set.
 * @returns {RuleSettings}
 */
export function defaultRuleSettings() {
  return Object.fromEntries(AUTOMATION_RULES.map((rule) => [rule.id, inactive(rule)]));
}

/**
 * Check one rule's setting from the client. An active rule needs every value;
 * an inactive one may leave values empty, but what it has must be valid.
 * @param {AutomationRule} rule
 * @param {any} input
 * @returns {{ setting: RuleSetting, error?: undefined } | { error: string, setting?: undefined }}
 */
function parseRuleSetting(rule, input) {
  if (!input || typeof input !== 'object') return { error: `rules.${rule.id} is required` };
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
 * Check the rule settings from the client: every rule must be there, and none unknown.
 * @param {any} input
 * @returns {{ rules: RuleSettings, error?: undefined } | { error: string, rules?: undefined }}
 */
export function parseRuleSettings(input) {
  if (!input || typeof input !== 'object') return { error: 'rules is required' };
  const unknown = Object.keys(input).filter((id) => !AUTOMATION_RULES.some((rule) => rule.id === id));
  if (unknown.length) return { error: `unknown rule: ${unknown.join(', ')}` };
  /** @type {RuleSettings} */
  const rules = {};
  for (const rule of AUTOMATION_RULES) {
    const { setting, error } = parseRuleSetting(rule, input[rule.id]);
    if (error !== undefined) return { error };
    rules[rule.id] = setting;
  }
  return { rules };
}

/**
 * Stored rule settings brought up to date: rules added since they were saved
 * come in inactive, and rules that no longer exist are dropped.
 * @param {any} stored
 * @returns {RuleSettings}
 */
export function ruleSettingsWithDefaults(stored) {
  const rules = defaultRuleSettings();
  if (!stored || typeof stored !== 'object') return rules;
  for (const rule of AUTOMATION_RULES) {
    const { setting } = parseRuleSetting(rule, stored[rule.id]);
    if (setting) rules[rule.id] = setting;
  }
  return rules;
}
