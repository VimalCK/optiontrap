/**
 * Trade automation: what can be traded automatically, the stages every
 * automated trade goes through, and the user's configuration.
 *
 * Shared by the server (which will run the automation) and the browser (the
 * Automation page), so both agree on the same names and rules.
 *
 * An automated trade's lifecycle, recorded stage by stage:
 *   selected   a signal picked it (intraday: from the server's OI snapshots)
 *   validated  it passed every active entry rule (shared/entryRules/)
 *   rejected   a rule refused it, at selection or execution; it ends here
 *   executed   sent to paper (or, later, live) trading: it is now a position.
 *              Automated trades in the same instrument merge into one
 *              automated position (100 then 500 shows as 600), so several
 *              trades can point at the same position.
 *   closed     the position was exited, by the user or by an active exit
 *              rule (shared/exitRules/); it ends here
 */
import { defaultRuleSettings, parseRuleSettings, ruleSettingsWithDefaults } from './rules/ruleSettings.js';
import { ENTRY_RULES } from './entryRules/index.js';
import { EXIT_RULES } from './exitRules/index.js';
import { HORIZONS, Horizon, InstrumentType, LifecycleStage, SIDES, Side, TradeKind, TradingMode, horizonLabel, isOptionType, sideLabel } from './tradeEnums.js';

/**
 * @typedef {import('./tradeEnums.js').TradeKindId} TradeKindId
 * @typedef {import('./tradeEnums.js').HorizonId} HorizonId
 * @typedef {import('./tradeEnums.js').SideId} SideId
 * @typedef {import('./tradeEnums.js').TradingModeId} TradingModeId
 * @typedef {import('./rules/ruleSettings.js').RuleInfo} RuleInfo  a strategy as the configuration knows it (the trade engine's, GET /api/strategies)
 * @typedef {{
 *   enabled: boolean,
 *   mode: TradingModeId,
 *   horizons: Record<HorizonId, boolean>,
 *   kinds: Record<TradeKindId, Record<SideId, boolean>>,
 *   strategies: import('./rules/ruleSettings.js').RuleSettings,
 *   entryRules: import('./rules/ruleSettings.js').RuleSettings,
 *   exitRules: import('./rules/ruleSettings.js').RuleSettings,
 * }} AutomationConfig
 */

/** Trade types, as the user turns them on and off. */
export const TRADE_KINDS = [
  { id: TradeKind.Stock, label: 'Stock' },
  { id: TradeKind.StockOption, label: 'Stock option' },
  { id: TradeKind.StockFuture, label: 'Stock future' },
  { id: TradeKind.IndexOption, label: 'Index option' },
  { id: TradeKind.IndexFuture, label: 'Index future' },
];

/**
 * Where trades come from. Intraday trades follow the OI snapshots; positional
 * trades will follow OI history and are not built yet. Defined in
 * shared/tradeEnums.js, which positions and orders share.
 */
export { HORIZONS };

/** Where executed trades go. Live trading places real orders and is not built yet. */
export const EXECUTION_MODES = [
  { id: TradingMode.Paper, label: 'Paper trading', available: true },
  { id: TradingMode.Live, label: 'Live trading', available: false },
];

export const LIFECYCLE_STAGES = [
  { id: LifecycleStage.Selected, label: 'Selected', final: false },
  { id: LifecycleStage.Validated, label: 'Validated', final: false },
  { id: LifecycleStage.Rejected, label: 'Rejected', final: true },
  { id: LifecycleStage.Executed, label: 'Executed', final: false },
  { id: LifecycleStage.Closed, label: 'Closed', final: true },
];

/** Win/Loss Patterns groups closed trades by entry time in IST slots this many minutes long. */
export const RESULTS_ENTRY_SLOT_MINUTES = 30;

/** The stages a trade may move to from each stage. @type {Record<string, string[]>} */
const NEXT_STAGES = {
  // The settings and entry rules refuse a signal before it is saved, so a saved
  // trade is rejected only after validation, when it cannot be placed.
  [LifecycleStage.Selected]: [LifecycleStage.Validated],
  [LifecycleStage.Validated]: [LifecycleStage.Executed, LifecycleStage.Rejected],
  [LifecycleStage.Executed]: [LifecycleStage.Closed],
  [LifecycleStage.Rejected]: [],
  [LifecycleStage.Closed]: [],
};

/**
 * Whether a trade at stage `from` may move to `to`.
 * @param {string} from
 * @param {string} to
 */
export function canMoveTo(from, to) {
  return (NEXT_STAGES[from] ?? []).includes(to);
}

/**
 * Every trade type and side off, so nothing trades until the user chooses.
 * @returns {AutomationConfig['kinds']}
 */
function noKinds() {
  return /** @type {AutomationConfig['kinds']} */ (Object.fromEntries(TRADE_KINDS.map((kind) => [kind.id, { BUY: false, SELL: false }])));
}

/**
 * The configuration of a user who hasn't saved one: off, paper, intraday,
 * nothing chosen, every strategy and entry and exit rule inactive.
 * @param {RuleInfo[]} strategies  the trade engine's strategies (GET /api/strategies)
 * @returns {AutomationConfig}
 */
export function defaultAutomationConfig(strategies) {
  return {
    enabled: false,
    mode: TradingMode.Paper,
    horizons: { [Horizon.Intraday]: true, [Horizon.Positional]: false },
    kinds: noKinds(),
    strategies: defaultRuleSettings(strategies),
    entryRules: defaultRuleSettings(ENTRY_RULES),
    exitRules: defaultRuleSettings(EXIT_RULES),
  };
}

/**
 * Check a configuration from the client. Returns `{ config }` ready to store,
 * or `{ error }` with a message for the user. Every field is required, so a
 * saved configuration is always complete.
 * @param {any} input
 * @param {RuleInfo[]} strategyInfos  the trade engine's strategies
 * @returns {{ config: AutomationConfig, error?: undefined } | { error: string, config?: undefined }}
 */
export function parseAutomationConfig(input, strategyInfos) {
  if (!input || typeof input !== 'object') return { error: 'configuration is required' };
  const { enabled, mode, horizons, kinds, strategies, entryRules, exitRules } = input;

  if (typeof enabled !== 'boolean') return { error: 'enabled must be true or false' };

  const executionMode = EXECUTION_MODES.find((m) => m.id === mode);
  if (!executionMode) return { error: `mode must be one of: ${EXECUTION_MODES.map((m) => m.id).join(', ')}` };
  if (!executionMode.available) return { error: `${executionMode.label} is not available yet` };

  if (!horizons || typeof horizons !== 'object') return { error: 'horizons is required' };
  const parsedHorizons = /** @type {Record<string, boolean>} */ ({});
  for (const horizon of HORIZONS) {
    const on = horizons[horizon.id];
    if (typeof on !== 'boolean') return { error: `horizons.${horizon.id} must be true or false` };
    if (on && !horizon.available) return { error: `${horizon.label} trades are not available yet` };
    parsedHorizons[horizon.id] = on;
  }

  if (!kinds || typeof kinds !== 'object') return { error: 'kinds is required' };
  const unknown = Object.keys(kinds).filter((id) => !TRADE_KINDS.some((kind) => kind.id === id));
  if (unknown.length) return { error: `unknown trade type: ${unknown.join(', ')}` };
  const parsedKinds = /** @type {Record<string, Record<SideId, boolean>>} */ ({});
  for (const kind of TRADE_KINDS) {
    const sides = kinds[kind.id];
    if (!sides || SIDES.some((side) => typeof sides[side.id] !== 'boolean')) {
      return { error: `kinds.${kind.id} must say true or false for BUY and SELL` };
    }
    parsedKinds[kind.id] = { [Side.BUY]: sides[Side.BUY], [Side.SELL]: sides[Side.SELL] };
  }

  const parsedStrategies = parseRuleSettings(strategyInfos, strategies, 'strategies');
  if (parsedStrategies.error !== undefined) return { error: parsedStrategies.error };
  const parsedEntryRules = parseRuleSettings(ENTRY_RULES, entryRules, 'entryRules');
  if (parsedEntryRules.error !== undefined) return { error: parsedEntryRules.error };
  const parsedExitRules = parseRuleSettings(EXIT_RULES, exitRules, 'exitRules');
  if (parsedExitRules.error !== undefined) return { error: parsedExitRules.error };

  return {
    config: {
      enabled,
      mode,
      horizons: /** @type {AutomationConfig['horizons']} */ (parsedHorizons),
      kinds: /** @type {AutomationConfig['kinds']} */ (parsedKinds),
      strategies: parsedStrategies.settings,
      entryRules: parsedEntryRules.settings,
      exitRules: parsedExitRules.settings,
    },
  };
}

/**
 * A stored configuration brought up to date: trade types or horizons added
 * since it was saved come in switched off, and any that no longer exist are
 * dropped. The same goes for strategies and entry and exit rules.
 * @param {any} stored
 * @param {RuleInfo[]} strategies  the trade engine's strategies
 * @returns {AutomationConfig}
 */
export function withDefaults(stored, strategies) {
  const base = defaultAutomationConfig(strategies);
  if (!stored || typeof stored !== 'object') return base;
  const kinds = /** @type {Record<string, Record<SideId, boolean>>} */ (noKinds());
  for (const kind of TRADE_KINDS) {
    const sides = stored.kinds?.[kind.id];
    if (sides) kinds[kind.id] = { [Side.BUY]: sides[Side.BUY] === true, [Side.SELL]: sides[Side.SELL] === true };
  }
  const horizons = /** @type {Record<string, boolean>} */ ({ ...base.horizons });
  for (const horizon of HORIZONS) {
    if (typeof stored.horizons?.[horizon.id] === 'boolean') horizons[horizon.id] = stored.horizons[horizon.id] && horizon.available;
  }
  const mode = EXECUTION_MODES.some((m) => m.id === stored.mode && m.available) ? stored.mode : base.mode;
  return {
    enabled: stored.enabled === true,
    mode,
    horizons: /** @type {AutomationConfig['horizons']} */ (horizons),
    kinds: /** @type {AutomationConfig['kinds']} */ (kinds),
    strategies: ruleSettingsWithDefaults(strategies, stored.strategies),
    entryRules: ruleSettingsWithDefaults(ENTRY_RULES, stored.entryRules),
    exitRules: ruleSettingsWithDefaults(EXIT_RULES, stored.exitRules),
  };
}

/**
 * The trade type of an instrument: options, futures or a stock, of an index
 * or a stock underlying. Null for something that can't be traded (an index itself).
 * @param {string} instrumentType  CE, PE, FUT or EQ
 * @param {boolean} isIndex  whether the underlying is an index (instruments table)
 * @returns {TradeKindId | null}
 */
export function tradeKind(instrumentType, isIndex) {
  if (isOptionType(instrumentType)) return isIndex ? TradeKind.IndexOption : TradeKind.StockOption;
  if (instrumentType === InstrumentType.FUT) return isIndex ? TradeKind.IndexFuture : TradeKind.StockFuture;
  if (instrumentType === InstrumentType.EQ) return isIndex ? null : TradeKind.Stock;
  return null;
}

/**
 * @typedef {{ horizon: HorizonId, kind: TradeKindId, side: SideId }} GeneralTrade
 * @typedef {{ id: string, check: (trade: GeneralTrade, config: AutomationConfig) => string | null }} GeneralCheck
 */

const kindLabel = (/** @type {string} */ id) => TRADE_KINDS.find((k) => k.id === id)?.label ?? id;

/**
 * What the General tab allows, checked on every selected trade before the
 * entry rules: a trade the user hasn't switched on is rejected with the reason.
 * @type {GeneralCheck[]}
 */
export const GENERAL_CHECKS = [
  { id: 'automation-on', check: (_trade, config) => (config.enabled ? null : 'Automation is off') },
  { id: 'horizon-on', check: (trade, config) => (config.horizons[trade.horizon] ? null : `${horizonLabel(trade.horizon)} trades are off`) },
  {
    id: 'trade-type-on',
    check: (trade, config) => (config.kinds[trade.kind]?.[trade.side] ? null : `${sideLabel(trade.side)} ${kindLabel(trade.kind)} is off`),
  },
];

/**
 * The first General setting that refuses this trade, or null.
 * @param {GeneralTrade} trade
 * @param {AutomationConfig} config
 */
export function checkGeneralSettings(trade, config) {
  for (const { check } of GENERAL_CHECKS) {
    const reason = check(trade, config);
    if (reason) return reason;
  }
  return null;
}
