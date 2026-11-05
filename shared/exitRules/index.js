/**
 * Automation exit rules: the plug-in list the trade monitor checks every open
 * automated position against; the first active rule that fires closes the
 * position (executed → closed), with its reason on the trade's lifecycle.
 *
 * Each rule is its own file in this folder; the shape of a rule and the
 * settings logic are shared with the entry rules (shared/rules/ruleSettings.js).
 * To add a rule, add its file and put it in EXIT_RULES. The settings page,
 * the stored config and the runner pick it up from this list; nothing else
 * changes. A rule only reads the position and `ctx`; a fact a new rule needs
 * is added to ExitRuleContext once, where the monitor builds it.
 *
 * Rules start inactive, so nothing is closed until the user sets it.
 */
import { firstRuleThatFires } from '../rules/ruleSettings.js';
import stopLoss from './stopLoss.js';
import target from './target.js';
import squareOff from './squareOff.js';

/**
 * @typedef {import('../rules/ruleSettings.js').RuleSettings} RuleSettings
 * @typedef {{ instrumentToken: number, tradingsymbol: string, pnl: number }} OpenAutoPosition
 *   pnl is the position's live P&L in ₹
 * @typedef {{ now: Date }} ExitRuleContext
 * @typedef {import('../rules/ruleSettings.js').Rule<OpenAutoPosition, ExitRuleContext>} ExitRule
 */

/** Every exit rule, in the order they're checked. @type {ExitRule[]} */
export const EXIT_RULES = [stopLoss, target, squareOff];

/**
 * Run the user's active exit rules on an open position: the first that fires
 * says why to exit, or null to keep it open.
 * @param {OpenAutoPosition} position
 * @param {ExitRuleContext} ctx
 * @param {RuleSettings} settings
 * @returns {{ ruleId: string, reason: string } | null}
 */
export function checkExitRules(position, ctx, settings) {
  return firstRuleThatFires(EXIT_RULES, position, ctx, settings);
}
