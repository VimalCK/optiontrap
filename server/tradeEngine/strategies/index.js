/**
 * Trade engine strategies: the plug-in list that decides what to trade.
 *
 * Each strategy is one file here, whole: what it is (id, label, description,
 * params: shown on the Automation page through GET /api/strategies, with an
 * Active / Inactive setting per user, shared/rules/ruleSettings.js) and how it
 * runs. The trade engine (server/tradeEngine/host.js) starts every strategy
 * with the server; each decides when and how it runs, on the market clock it
 * is given (ctx.market). When it has something new it calls
 * ctx.services.signals.submit(id, prepared), and the signals service does the
 * rest for each user with the strategy on: their picks (select), the General
 * settings, the entry rules, the size (the Max lots entry rule), the order and
 * the lifecycle record.
 *
 * A strategy has:
 *   start(ctx), stop?()     its own schedule and data
 *   prepare(input)          the market work, once for all users
 *                           (e.g. scoring every chain); must not depend on
 *                           any user's settings
 *   select(prepared, params, { allows })
 *                           one user's signals, with their settings:
 *                           { instrumentToken, side, reason, setup? }. `allows` says
 *                           whether their General settings allow a trade
 *                           (buy or sell, trade type), so a strategy can pick
 *                           its best allowed trade instead of one they'd refuse.
 * The instrument's details (symbol, type, expiry, lot size, index or stock)
 * come from the instrument list, never from the strategy.
 *
 * To add a strategy, add its file here and put it in STRATEGIES; the engine,
 * the settings page and the stored config pick it up from this list.
 */
import { optionAnalyzerSetups } from './optionAnalyzerSetups.js';

/**
 * A signal: what to trade and why. `setup` names the pattern it traded (e.g.
 * "Bull put"), so Win/Loss Patterns can group results by it.
 * @typedef {{ instrumentToken: number, side: import('../../../shared/tradeEnums.js').SideId, reason: string, setup?: string }} Signal
 * @typedef {{ instrumentToken: number, tradingsymbol: string, name: string, exchange: string, instrumentType: string,
 *             strike: number, expiry: string | null }} StrategyInstrument
 * @typedef {{ name: string, instrumentToken: number | null, isIndex: boolean }} StrategyUnderlying
 * @typedef {import('../../../shared/rules/ruleSettings.js').RuleInfo} StrategyInfo  what the Automation page shows of a strategy
 */

/**
 * What a strategy's market work gets.
 * @typedef {object} StrategyInput
 * @property {Date} now
 * @property {import('../../../shared/optionAnalysis/velocityPattern.js').OiSnapshot[]} snapshots  today's OI snapshots, oldest first
 * @property {StrategyInstrument[]} instruments  today's instrument list
 * @property {StrategyUnderlying[]} underlyings  from the instruments table
 */

/**
 * @template [P=any]  what prepare hands to select
 * @typedef {StrategyInfo & {
 *   start: (ctx: import('../host.js').PluginContext) => unknown,
 *   stop?: () => unknown,
 *   prepare: (input: StrategyInput) => P,
 *   select: (prepared: P, params: Record<string, any>, user: { allows: (signal: Signal) => boolean }) => Signal[],
 * }} Strategy
 */

/** Every strategy, in the order they start. @type {Strategy[]} */
export const STRATEGIES = [optionAnalyzerSetups];

/** What the Automation page and the stored config need of each strategy: id, label, description, params. */
export const strategyInfos = (/** @type {Strategy[]} */ strategies = STRATEGIES) =>
  strategies.map(({ id, label, description, params }) => ({ id, label, description, params }));
