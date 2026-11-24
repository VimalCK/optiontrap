/**
 * Automation exit rules, each strategy's own, checked by the trade monitor against every open automated position of
 * that strategy, then the account's general exit rules (shared/generalRules/). The first active rule that fires
 * closes it (executed → closed).
 *
 * A rule only reads the position and `ctx`; a fact a new rule needs is added
 * to ExitRuleContext once, where the monitor builds it. Rules start inactive.
 */
import { firstRuleThatFires } from '../rules/ruleSettings.js';
import { GENERAL_EXIT_RULES } from '../generalRules/index.js';
import stopLoss from './stopLoss.js';
import target from './target.js';
import squareOff from './squareOff.js';

/**
 * @typedef {import('../rules/ruleSettings.js').ScopedRuleSettings} ScopedRuleSettings
 * @typedef {{ instrumentToken: number, tradingsymbol: string, horizon: import('../tradeEnums.js').HorizonId, pnl: number, pnlPercent: number,
 *             peakPnlPercent: number }} OpenAutoPosition
 *   pnl in ₹; pnlPercent as a percentage of its entry price; peakPnlPercent the same at its best price
 *   since the trade monitor started watching it (in memory: a restart starts it again from the price then)
 * @typedef {{ now: Date, todayAutoPnl: number }} ExitRuleContext
 *   todayAutoPnl is the owner's automated P&L today in ₹ across all strategies: booked plus open positions at their last price
 * @typedef {import('../rules/ruleSettings.js').Rule<OpenAutoPosition, ExitRuleContext> & { blocksEntryOrders?: boolean }} ExitRule
 *   blocksEntryOrders: while it fires, the owner's automated entry orders are refused, and waiting ones cancelled
 * @typedef {{ instrumentToken: number, tradingsymbol: string, horizon: import('../tradeEnums.js').HorizonId }} EntryOrder
 */

/** A strategy's exit rules, in the order they're checked. @type {ExitRule[]} */
export const EXIT_RULES = [stopLoss, target, squareOff];

const blocksEntryOrders = (/** @type {ExitRule} */ rule) => rule.blocksEntryOrders === true;
const ENTRY_BLOCKING_RULES = EXIT_RULES.filter(blocksEntryOrders);
const GENERAL_ENTRY_BLOCKING_RULES = GENERAL_EXIT_RULES.filter(blocksEntryOrders);

/** The id of the trade engine's square-off after the market close (server/tradeEngine/services/sessionSquareOff.js). */
export const SESSION_SQUARE_OFF_ID = 'session-square-off';

/** Exits the trade engine makes itself, not a user's rule. */
export const ENGINE_EXITS = [{ id: SESSION_SQUARE_OFF_ID, label: 'Session square-off' }];

/** What a recorded exit's rule id is called (a strategy's rule, a general rule or the engine's own), or the id itself. */
export const exitLabel = (/** @type {string} */ id) =>
  [...EXIT_RULES, ...GENERAL_EXIT_RULES, ...ENGINE_EXITS].find((exit) => exit.id === id)?.label ?? id;

/**
 * The strategy's exit rules first, then the account's general ones.
 * @param {OpenAutoPosition} position
 * @param {ExitRuleContext} ctx
 * @param {ScopedRuleSettings} settings
 * @returns {{ ruleId: string, reason: string } | null}
 */
export function checkExitRules(position, ctx, settings) {
  return firstRuleThatFires(EXIT_RULES, position, ctx, settings.strategy)
    ?? firstRuleThatFires(GENERAL_EXIT_RULES, position, ctx, settings.general);
}

/**
 * The rule that blocks an automated entry order now (refused if new, cancelled if waiting), if any: checked on the
 * position the order would open, at no P&L yet.
 * @param {EntryOrder} order
 * @param {ExitRuleContext} ctx
 * @param {ScopedRuleSettings} settings
 * @returns {{ ruleId: string, reason: string } | null}
 */
export function checkEntryOrderBlocked(order, ctx, settings) {
  const position = { ...order, pnl: 0, pnlPercent: 0, peakPnlPercent: 0 };
  return firstRuleThatFires(ENTRY_BLOCKING_RULES, position, ctx, settings.strategy)
    ?? firstRuleThatFires(GENERAL_ENTRY_BLOCKING_RULES, position, ctx, settings.general);
}
