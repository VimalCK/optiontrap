/**
 * Trade automation: what can be traded automatically, the stages every
 * automated trade goes through, and the user's configuration. Shared by the
 * server and the browser.
 *
 * The configuration: the account's Algo Trading switch and general rules (shared/generalRules/), over every strategy,
 * then each strategy's own settings: active, its params, the modes it trades in (paper, live or both), its horizons,
 * and its own entry and exit rules.
 *
 * An automated trade's lifecycle, recorded stage by stage:
 *   selected   a strategy's signal picked it (intraday: from the server's OI snapshots)
 *   validated  it passed the account's general rules and every active entry rule of its strategy
 *   rejected   it could not be placed after validation; it ends here
 *   executed   sent to paper (or, later, live) trading: it is now a position.
 *              A strategy's trades in the same instrument merge into one
 *              position of that strategy (100 then 500 shows as 600), so several
 *              trades can point at the same position.
 *   closed     the position was exited, by the user or by an active exit
 *              rule; it ends here
 */
import { defaultRuleSettings, parseRuleSettings, ruleSettingsWithDefaults } from './rules/ruleSettings.js';
import { ENTRY_RULES } from './entryRules/index.js';
import { EXIT_RULES } from './exitRules/index.js';
import { GENERAL_RULES } from './generalRules/index.js';
import { HORIZONS, Horizon, InstrumentType, LifecycleStage, TradeKind, TradingMode, horizonLabel, isOptionType } from './tradeEnums.js';

/**
 * @typedef {import('./tradeEnums.js').TradeKindId} TradeKindId
 * @typedef {import('./tradeEnums.js').HorizonId} HorizonId
 * @typedef {import('./tradeEnums.js').TradingModeId} TradingModeId
 * @typedef {import('./rules/ruleSettings.js').RuleInfo} RuleInfo  a strategy as the configuration knows it (the trade engine's, GET /api/strategies)
 * @typedef {import('./rules/ruleSettings.js').RuleSettings} RuleSettings
 * @typedef {import('./rules/ruleSettings.js').RuleSetting} RuleSetting
 * @typedef {Record<TradingModeId, boolean>} ExecutionSettings  the modes a strategy trades in: paper, live or both at once
 * @typedef {Record<HorizonId, boolean>} HorizonSettings
 * @typedef {RuleSetting & {
 *   execution: ExecutionSettings,
 *   horizons: HorizonSettings,
 *   entryRules: RuleSettings,
 *   exitRules: RuleSettings,
 * }} StrategySettings  active and its params (Min score …), then where and what it trades, and its own rules
 * @typedef {{ enabled: boolean, generalRules: RuleSettings, strategies: Record<string, StrategySettings> }} AutomationConfig
 *   enabled: the account's Algo Trading switch, over every strategy; generalRules: the account's rules over every strategy
 */

/** Intraday trades follow the OI snapshots; positional trades are not built yet. */
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
 * @param {{ id: string, available: boolean }[]} options  e.g. EXECUTION_MODES
 * @param {(option: { id: string, available: boolean }) => boolean} isOn
 * @returns {Record<string, boolean>}
 */
const switches = (options, isOn) => Object.fromEntries(options.map((option) => [option.id, isOn(option)]));

/**
 * One on/off switch per option from the client: every option is required, and one that isn't built yet can't be on.
 * @param {{ id: string, label: string, available: boolean }[]} options
 * @param {any} input
 * @param {string} field  where the switches sit in the config, for messages
 * @param {(option: { label: string }) => string} [notAvailable]  the message for an option switched on before it is built
 * @returns {{ switches: Record<string, boolean>, error?: undefined } | { error: string, switches?: undefined }}
 */
function parseSwitches(options, input, field, notAvailable = (option) => `${option.label} is not available yet`) {
  if (!input || typeof input !== 'object') return { error: `${field} is required` };
  for (const option of options) {
    if (typeof input[option.id] !== 'boolean') return { error: `${field}.${option.id} must be true or false` };
    if (input[option.id] && !option.available) return { error: notAvailable(option) };
  }
  return { switches: switches(options, (option) => input[option.id]) };
}

/**
 * Stored switches brought up to date: an option added since they were saved takes its default, and one that isn't
 * built yet is off.
 * @param {{ id: string, available: boolean }[]} options
 * @param {any} stored
 * @param {Record<string, boolean>} defaults
 */
const switchesWithDefaults = (options, stored, defaults) =>
  switches(options, (option) => option.available && (typeof stored?.[option.id] === 'boolean' ? stored[option.id] : defaults[option.id]));

/**
 * A strategy's settings before the user changes them: inactive, on paper, intraday, every rule off.
 * @param {RuleInfo} strategy
 * @returns {StrategySettings}
 */
function defaultStrategySettings(strategy) {
  return {
    ...defaultRuleSettings([strategy])[strategy.id],
    execution: /** @type {ExecutionSettings} */ (switches(EXECUTION_MODES, (mode) => mode.id === TradingMode.Paper)),
    horizons: /** @type {HorizonSettings} */ (switches(HORIZONS, (horizon) => horizon.id === Horizon.Intraday)),
    entryRules: defaultRuleSettings(ENTRY_RULES),
    exitRules: defaultRuleSettings(EXIT_RULES),
  };
}

/**
 * @param {RuleInfo[]} strategies  the trade engine's strategies (GET /api/strategies)
 * @returns {AutomationConfig}
 */
export function defaultAutomationConfig(strategies) {
  return {
    enabled: false,
    generalRules: defaultRuleSettings(GENERAL_RULES),
    strategies: Object.fromEntries(strategies.map((strategy) => [strategy.id, defaultStrategySettings(strategy)])),
  };
}

/**
 * One strategy's settings from the client.
 * @param {RuleInfo} strategy
 * @param {any} input
 * @returns {{ settings: StrategySettings, error?: undefined } | { error: string, settings?: undefined }}
 */
function parseStrategySettings(strategy, input) {
  const field = `strategies.${strategy.id}`;
  if (!input || typeof input !== 'object') return { error: `${field} is required` };
  const own = parseRuleSettings([strategy], { [strategy.id]: input }, 'strategies');
  if (own.error !== undefined) return { error: own.error };
  const execution = parseSwitches(EXECUTION_MODES, input.execution, `${field}.execution`);
  if (execution.error !== undefined) return { error: execution.error };
  const horizons = parseSwitches(HORIZONS, input.horizons, `${field}.horizons`, (horizon) => `${horizon.label} trades are not available yet`);
  if (horizons.error !== undefined) return { error: horizons.error };
  const entryRules = parseRuleSettings(ENTRY_RULES, input.entryRules, `${field}.entryRules`);
  if (entryRules.error !== undefined) return { error: entryRules.error };
  const exitRules = parseRuleSettings(EXIT_RULES, input.exitRules, `${field}.exitRules`);
  if (exitRules.error !== undefined) return { error: exitRules.error };
  return {
    settings: {
      ...own.settings[strategy.id],
      execution: /** @type {ExecutionSettings} */ (execution.switches),
      horizons: /** @type {HorizonSettings} */ (horizons.switches),
      entryRules: entryRules.settings,
      exitRules: exitRules.settings,
    },
  };
}

/**
 * Returns `{ config }` ready to store, or `{ error }` for the user. Every field
 * is required, so a saved configuration is always complete.
 * @param {any} input
 * @param {RuleInfo[]} strategyInfos  the trade engine's strategies
 * @returns {{ config: AutomationConfig, error?: undefined } | { error: string, config?: undefined }}
 */
export function parseAutomationConfig(input, strategyInfos) {
  if (!input || typeof input !== 'object') return { error: 'configuration is required' };
  const { enabled, generalRules, strategies } = input;
  if (typeof enabled !== 'boolean') return { error: 'enabled must be true or false' };

  const general = parseRuleSettings(GENERAL_RULES, generalRules, 'generalRules');
  if (general.error !== undefined) return { error: general.error };

  if (!strategies || typeof strategies !== 'object') return { error: 'strategies is required' };
  const unknown = Object.keys(strategies).filter((id) => !strategyInfos.some((strategy) => strategy.id === id));
  if (unknown.length) return { error: `unknown strategy: ${unknown.join(', ')}` };
  /** @type {Record<string, StrategySettings>} */
  const parsedStrategies = {};
  for (const strategy of strategyInfos) {
    const parsed = parseStrategySettings(strategy, strategies[strategy.id]);
    if (parsed.error !== undefined) return { error: `${strategy.label}: ${parsed.error}` };
    parsedStrategies[strategy.id] = parsed.settings;
  }

  return { config: { enabled, generalRules: general.settings, strategies: parsedStrategies } };
}

/**
 * One on/off switch from the client, e.g. `{ enabled }` (Algo Trading) or `{ active }` (a strategy).
 * @param {any} input
 * @param {string} key
 * @returns {{ on: boolean, error?: undefined } | { error: string, on?: undefined }}
 */
export function parseSwitch(input, key) {
  if (typeof input?.[key] !== 'boolean') return { error: `${key} must be true or false` };
  return { on: input[key] };
}

/**
 * The configuration with one strategy switched on or off, or why it can't be switched on (a value it needs is unset).
 * @param {AutomationConfig} config  complete (withDefaults)
 * @param {RuleInfo} strategy
 * @param {boolean} active
 * @returns {{ config: AutomationConfig, error?: undefined } | { error: string, config?: undefined }}
 */
export function withStrategyActive(config, strategy, active) {
  const settings = { ...config.strategies[strategy.id], active };
  const checked = parseRuleSettings([strategy], { [strategy.id]: settings }, 'strategies');
  if (checked.error !== undefined) return { error: checked.error };
  return { config: { ...config, strategies: { ...config.strategies, [strategy.id]: settings } } };
}

/**
 * A stored strategy's settings brought up to date (see withDefaults).
 * @param {RuleInfo} strategy
 * @param {any} stored
 * @returns {StrategySettings}
 */
function strategySettingsWithDefaults(strategy, stored) {
  const defaults = defaultStrategySettings(strategy);
  if (!stored || typeof stored !== 'object') return defaults;
  return {
    ...ruleSettingsWithDefaults([strategy], { [strategy.id]: stored })[strategy.id],
    execution: /** @type {ExecutionSettings} */ (switchesWithDefaults(EXECUTION_MODES, stored.execution, defaults.execution)),
    horizons: /** @type {HorizonSettings} */ (switchesWithDefaults(HORIZONS, stored.horizons, defaults.horizons)),
    entryRules: ruleSettingsWithDefaults(ENTRY_RULES, stored.entryRules),
    exitRules: ruleSettingsWithDefaults(EXIT_RULES, stored.exitRules),
  };
}

/**
 * A stored configuration brought up to date: strategies, rules, modes or horizons added since it was saved come in
 * with their defaults (off); removed ones are dropped.
 * @param {any} stored
 * @param {RuleInfo[]} strategies  the trade engine's strategies
 * @returns {AutomationConfig}
 */
export function withDefaults(stored, strategies) {
  if (!stored || typeof stored !== 'object') return defaultAutomationConfig(strategies);
  return {
    enabled: stored.enabled === true,
    generalRules: ruleSettingsWithDefaults(GENERAL_RULES, stored.generalRules),
    strategies: Object.fromEntries(strategies.map((strategy) => [strategy.id, strategySettingsWithDefaults(strategy, stored.strategies?.[strategy.id])])),
  };
}

/**
 * The exit rules for a strategy's position: the strategy's own and the account's general ones. A strategy no longer
 * in the configuration has none of its own; the general ones still apply.
 * @param {AutomationConfig} config
 * @param {string | null} strategyId
 * @returns {import('./rules/ruleSettings.js').ScopedRuleSettings}
 */
export const exitRuleSettings = (config, strategyId) => ({
  strategy: (strategyId && config.strategies[strategyId]?.exitRules) || {},
  general: config.generalRules,
});

/**
 * The modes a strategy trades in now: each signal is placed once in each.
 * @param {StrategySettings} strategy
 * @returns {TradingModeId[]}
 */
export const executionModes = (strategy) => EXECUTION_MODES.filter((mode) => strategy.execution[mode.id]).map((mode) => mode.id);

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
 * @typedef {{ horizon: HorizonId }} StrategyTrade
 * @typedef {{ id: string, check: (trade: StrategyTrade, config: AutomationConfig, strategy: StrategySettings) => string | null }} StrategyCheck
 */

/**
 * Checked on every trade a strategy picks, before the rules.
 * @type {StrategyCheck[]}
 */
const STRATEGY_CHECKS = [
  { id: 'automation-on', check: (_trade, config) => (config.enabled ? null : 'Algo Trading is off') },
  { id: 'strategy-active', check: (_trade, _config, strategy) => (strategy.active ? null : 'The strategy is inactive') },
  { id: 'execution-on', check: (_trade, _config, strategy) => (executionModes(strategy).length > 0 ? null : 'Paper and live trading are both off') },
  { id: 'horizon-on', check: (trade, _config, strategy) => (strategy.horizons[trade.horizon] ? null : `${horizonLabel(trade.horizon)} trades are off`) },
];

/**
 * Why the account switch or the strategy's own settings refuse this trade, or null.
 * @param {StrategyTrade} trade
 * @param {AutomationConfig} config
 * @param {string} strategyId
 */
export function checkStrategySettings(trade, config, strategyId) {
  const strategy = config.strategies[strategyId];
  if (!strategy) return 'Unknown strategy';
  for (const { check } of STRATEGY_CHECKS) {
    const reason = check(trade, config, strategy);
    if (reason) return reason;
  }
  return null;
}
