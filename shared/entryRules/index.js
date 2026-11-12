/**
 * Automation entry rules: the plug-in list every automated trade is checked
 * against before it is executed (selected → validated or rejected).
 *
 * Each rule is its own file in this folder; the shape of a rule and the
 * settings logic are shared with the exit rules (shared/rules/ruleSettings.js).
 * To add a rule, add its file and put it in ENTRY_RULES. The settings page,
 * the stored config and the runner pick it up from this list; nothing else
 * changes. A rule only reads `ctx`; a fact a new rule needs is added to
 * EntryRuleContext once, where the engine builds it.
 *
 * Users switch each rule between active and inactive. Rules start inactive
 * with no values, so nothing is limited until the user sets it.
 */
import { firstRuleThatFires } from '../rules/ruleSettings.js';
import maxLots from './maxLots.js';
import maxOpenPositions from './maxOpenPositions.js';
import oneTradePerInstrument from './oneTradePerInstrument.js';
import maxDailyLoss from './maxDailyLoss.js';
import waitAfterExit from './waitAfterExit.js';
import entryLimitOffset from './entryLimitOffset.js';
import { Side } from '../tradeEnums.js';

/**
 * @typedef {import('../rules/ruleSettings.js').RuleSettings} RuleSettings
 * @typedef {{ instrumentToken: number, tradingsymbol: string, side: string, quantity: number, lotSize: number }} CandidateTrade
 * @typedef {{
 *   now: Date,
 *   openAutoPositions: { instrumentToken: number }[],
 *   waitingAutoOrders: { instrumentToken: number }[],
 *   todayAutoPnl: number,
 *   todayAutoExits: { instrumentToken: number, exitTime: Date }[],
 * }} EntryRuleContext
 *   waitingAutoOrders: automated limit orders not filled yet, each a position about to open
 *   todayAutoExits: each instrument's latest automated exit today
 * @typedef {import('../rules/ruleSettings.js').Rule<CandidateTrade, EntryRuleContext>} EntryRule
 * @typedef {{ ok: true } | { ok: false, ruleId: string, reason: string }} EntryVerdict
 */

/** The size of an automated trade while the Max lots rule is off. */
export const DEFAULT_TRADE_LOTS = 1;

/**
 * How many lots an automated trade is: the Max lots value while that rule is active, else DEFAULT_TRADE_LOTS.
 * @param {RuleSettings} settings  the user's entry rules
 */
export function tradeLots(settings) {
  const setting = settings[maxLots.id];
  return setting?.active ? Number(setting.params.max) : DEFAULT_TRADE_LOTS;
}

/** NSE's price step for options and futures: a limit price is a multiple of it. */
const PRICE_TICK = 0.05;
/** Absorbs floating-point error when counting ticks (48 / 0.05 is 959.999…, not 960). */
const TICK_EPSILON = 1e-9;

/**
 * The limit price an automated entry is placed at: the Entry limit offset
 * percentage better than `lastPrice` (a buy below, a sell above), rounded to
 * the tick in the trade's favour; or null while that rule is off (enter at
 * the last price).
 * @param {RuleSettings} settings  the user's entry rules
 * @param {import('../tradeEnums.js').SideId} side
 * @param {number} lastPrice
 */
export function entryLimitPrice(settings, side, lastPrice) {
  const setting = settings[entryLimitOffset.id];
  if (!setting?.active) return null;
  const factor = Number(setting.params.percent) / 100;
  const ticks = side === Side.BUY
    ? Math.floor((lastPrice * (1 - factor)) / PRICE_TICK + TICK_EPSILON)
    : Math.ceil((lastPrice * (1 + factor)) / PRICE_TICK - TICK_EPSILON);
  return Number((ticks * PRICE_TICK).toFixed(2));
}

/** Every entry rule, in the order they're checked. @type {EntryRule[]} */
export const ENTRY_RULES = [maxLots, maxOpenPositions, maxDailyLoss, waitAfterExit, oneTradePerInstrument, entryLimitOffset];

/**
 * Run the user's active entry rules on a trade; the first that refuses it gives the reason.
 * @param {CandidateTrade} trade
 * @param {EntryRuleContext} ctx
 * @param {RuleSettings} settings
 * @returns {EntryVerdict}
 */
export function checkEntryRules(trade, ctx, settings) {
  const refusal = firstRuleThatFires(ENTRY_RULES, trade, ctx, settings);
  return refusal ? { ok: false, ...refusal } : { ok: true };
}
