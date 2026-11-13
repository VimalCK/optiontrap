/**
 * Automation exit rules, checked by the trade monitor against every open
 * automated position. The first active rule that fires closes it (executed → closed).
 *
 * A rule only reads the position and `ctx`; a fact a new rule needs is added
 * to ExitRuleContext once, where the monitor builds it. Rules start inactive.
 */
import { firstRuleThatFires } from '../rules/ruleSettings.js';
import stopLoss from './stopLoss.js';
import target from './target.js';
import squareOff from './squareOff.js';
import maxDailyLoss from './maxDailyLoss.js';

/**
 * @typedef {import('../rules/ruleSettings.js').RuleSettings} RuleSettings
 * @typedef {{ instrumentToken: number, tradingsymbol: string, horizon: import('../tradeEnums.js').HorizonId, pnl: number, pnlPercent: number }} OpenAutoPosition
 *   pnl in ₹; pnlPercent as a percentage of its entry price
 * @typedef {{ now: Date, todayAutoPnl: number }} ExitRuleContext
 *   todayAutoPnl is the owner's automated P&L today in ₹: booked plus open positions at their last price
 * @typedef {import('../rules/ruleSettings.js').Rule<OpenAutoPosition, ExitRuleContext>} ExitRule
 */

/** Every exit rule, in the order they're checked. @type {ExitRule[]} */
export const EXIT_RULES = [stopLoss, target, squareOff, maxDailyLoss];

/** The id of the trade engine's square-off after the market close (server/tradeEngine/services/sessionSquareOff.js). */
export const SESSION_SQUARE_OFF_ID = 'session-square-off';

/** Exits the trade engine makes itself, not a user's rule. */
export const ENGINE_EXITS = [{ id: SESSION_SQUARE_OFF_ID, label: 'Session square-off' }];

/**
 * @param {OpenAutoPosition} position
 * @param {ExitRuleContext} ctx
 * @param {RuleSettings} settings
 * @returns {{ ruleId: string, reason: string } | null}
 */
export function checkExitRules(position, ctx, settings) {
  return firstRuleThatFires(EXIT_RULES, position, ctx, settings);
}
