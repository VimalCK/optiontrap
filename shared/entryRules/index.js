/**
 * Automation entry rules, each strategy's own: every trade a strategy picks is checked against the account's general
 * entry rules (shared/generalRules/), then the strategy's, before it is executed (selected → validated or rejected).
 *
 * A rule only reads `ctx`; a fact a new rule needs is added to EntryRuleContext
 * once, where the engine builds it. Rules start inactive with no values, so
 * nothing is limited until the user sets it.
 */
import { firstRuleThatFires } from '../rules/ruleSettings.js';
import maxLots from './maxLots.js';
import oneTradePerInstrument from './oneTradePerInstrument.js';
import waitAfterExit from './waitAfterExit.js';
import entryLimitOffset from './entryLimitOffset.js';
import { GENERAL_ENTRY_RULES } from '../generalRules/index.js';
import { Side } from '../tradeEnums.js';

/**
 * @typedef {import('../rules/ruleSettings.js').RuleSettings} RuleSettings
 * @typedef {import('../rules/ruleSettings.js').ScopedRuleSettings} ScopedRuleSettings
 * @typedef {{ instrumentToken: number, tradingsymbol: string, side: string, quantity: number, lotSize: number }} CandidateTrade
 * @typedef {{
 *   now: Date,
 *   openAutoPositions: { instrumentToken: number, strategyId?: string | null }[],
 *   waitingAutoOrders: { instrumentToken: number, strategyId?: string | null }[],
 *   todayAutoPnl: number,
 *   todayAutoExits: { instrumentToken: number, strategyId?: string | null, exitTime: Date }[],
 * }} EntryRuleContext
 *   waitingAutoOrders: automated limit orders not filled yet, each a position about to open
 *   todayAutoPnl: the user's automated P&L today, across all strategies
 *   todayAutoExits: each instrument's latest automated exit today
 * @typedef {{ account: EntryRuleContext, strategy: EntryRuleContext }} EntryRuleContexts
 *   account: the facts across all the user's strategies, for the general rules; strategy: the strategy's own, for its rules
 * @typedef {import('../rules/ruleSettings.js').Rule<CandidateTrade, EntryRuleContext>} EntryRule
 * @typedef {{ ok: true } | { ok: false, ruleId: string, reason: string }} EntryVerdict
 */

/**
 * The account's facts, and one strategy's share of them: only its own positions, waiting orders and exits. Today's
 * P&L stays the account's (Max loss per day is a general rule).
 * @param {EntryRuleContext} account
 * @param {string} strategyId
 * @returns {EntryRuleContexts}
 */
export function entryRuleContexts(account, strategyId) {
  const own = (/** @type {{ strategyId?: string | null }} */ item) => item.strategyId === strategyId;
  return {
    account,
    strategy: {
      ...account,
      openAutoPositions: account.openAutoPositions.filter(own),
      waitingAutoOrders: account.waitingAutoOrders.filter(own),
      todayAutoExits: account.todayAutoExits.filter(own),
    },
  };
}

/** The size of an automated trade while the Max lots rule is off. */
export const DEFAULT_TRADE_LOTS = 1;

/**
 * How many lots an automated trade is: the Max lots value while that rule is active, else DEFAULT_TRADE_LOTS.
 * @param {RuleSettings} settings  the strategy's entry rules
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
 * @param {RuleSettings} settings  the strategy's entry rules
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

/** A strategy's entry rules, in the order they're checked. @type {EntryRule[]} */
export const ENTRY_RULES = [maxLots, waitAfterExit, oneTradePerInstrument, entryLimitOffset];

/**
 * The account's general entry rules first, then the strategy's own.
 * @param {CandidateTrade} trade
 * @param {EntryRuleContexts} ctx
 * @param {ScopedRuleSettings} settings
 * @returns {EntryVerdict}
 */
export function checkEntryRules(trade, ctx, settings) {
  const refusal = firstRuleThatFires(GENERAL_ENTRY_RULES, trade, ctx.account, settings.general)
    ?? firstRuleThatFires(ENTRY_RULES, trade, ctx.strategy, settings.strategy);
  return refusal ? { ok: false, ...refusal } : { ok: true };
}
