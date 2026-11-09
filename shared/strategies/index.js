/**
 * Automation strategies: the plug-in list that selects automated trades.
 *
 * The trade engine (server/autoTradeEngine.js) runs every strategy some user
 * has switched on after each scheduled OI snapshot (every 10 minutes in
 * market hours). A strategy only says what it would trade; the engine does
 * the rest for each user: the entry rules, the size (the Max lots entry rule),
 * opening the paper position and recording the lifecycle.
 *
 * A strategy is a rule-shaped plug-in (shared/rules/ruleSettings.js: id,
 * label, description, params, with an Active / Inactive setting per user)
 * with two steps:
 *   prepare(input)          the market work, once per run for all users
 *                           (e.g. scoring every chain)
 *   select(prepared, params, { allows })
 *                           one user's signals, with their settings:
 *                           { instrumentToken, side, reason, setup? }. `allows` says
 *                           whether their General settings allow a trade
 *                           (buy or sell, trade type), so a strategy can pick
 *                           its best allowed trade instead of one they'd refuse.
 * The instrument's details (symbol, type, expiry, lot size, index or stock)
 * come from the instrument list, never from the strategy.
 *
 * To add a strategy, add its file here and put it in STRATEGIES; the settings
 * page, the stored config and the engine pick it up from this list.
 */
import { optionAnalyzerSetups } from './optionAnalyzerSetups.js';

/**
 * A signal: what to trade and why. `setup` names the pattern it traded (e.g.
 * "Bull put"), so Win/Loss Patterns can group results by it.
 * @typedef {{ instrumentToken: number, side: 'BUY' | 'SELL', reason: string, setup?: string }} Signal
 * @typedef {{ instrumentToken: number, tradingsymbol: string, name: string, exchange: string, instrumentType: string,
 *             strike: number, expiry: string | null }} StrategyInstrument
 * @typedef {{ name: string, instrumentToken: number | null, isIndex: boolean }} StrategyUnderlying
 */

/**
 * What every strategy gets each run.
 * @typedef {object} StrategyInput
 * @property {Date} now
 * @property {import('../optionAnalysis/velocityPattern.js').OiSnapshot[]} snapshots  today's OI snapshots, oldest first
 * @property {StrategyInstrument[]} instruments  today's instrument list
 * @property {StrategyUnderlying[]} underlyings  from the instruments table
 */

/**
 * @template [P=any]  what prepare hands to select
 * @typedef {import('../rules/ruleSettings.js').RuleInfo & {
 *   prepare: (input: StrategyInput) => P,
 *   select: (prepared: P, params: Record<string, any>, user: { allows: (signal: Signal) => boolean }) => Signal[],
 * }} Strategy
 */

/** Every strategy, in the order they run. @type {Strategy[]} */
export const STRATEGIES = [optionAnalyzerSetups];
