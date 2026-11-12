/**
 * The app's non-trading vocabulary as enums, the way shared/tradeEnums.js does
 * the trading one: price alerts, feedback, subscriptions and scheduled job
 * runs. Code names a value by its member (`PriceAlertStatus.Active`), never by
 * a raw string, and each enum's list and check sit beside it.
 *
 * The members hold the text the database stores and the API sends, and each
 * value is its member's name (PriceAlertStatus.Active is 'Active'). SQL names a
 * value through sqlEnum (server/sql.js), which Postgres receives as a literal,
 * so partial indexes on it are used.
 *
 * Imports nothing, so any shared, server or browser module can use it.
 */

/** When a price alert fires: the price at or above its value, or at or below it. */
export const PriceAlertCondition = Object.freeze({ Above: 'Above', Below: 'Below' });

/** @typedef {typeof PriceAlertCondition[keyof typeof PriceAlertCondition]} PriceAlertConditionId */

/** Both conditions, with their labels. */
export const PRICE_ALERT_CONDITIONS = /** @type {{ id: PriceAlertConditionId, label: string }[]} */ ([
  { id: PriceAlertCondition.Above, label: 'Above' },
  { id: PriceAlertCondition.Below, label: 'Below' },
]);

/**
 * Whether `value` is a price alert condition.
 * @param {unknown} value
 * @returns {value is PriceAlertConditionId}
 */
export const isPriceAlertCondition = (value) => PRICE_ALERT_CONDITIONS.some((condition) => condition.id === value);

/** A condition's label (Above, Below), or the value itself when unknown. */
export const priceAlertConditionLabel = (/** @type {unknown} */ condition) => PRICE_ALERT_CONDITIONS.find((c) => c.id === condition)?.label ?? String(condition);

/** A price alert is waiting for its price, or has fired. */
export const PriceAlertStatus = Object.freeze({ Active: 'Active', Triggered: 'Triggered' });

/** @typedef {typeof PriceAlertStatus[keyof typeof PriceAlertStatus]} PriceAlertStatusId */

/** What a user's feedback is about. */
export const FeedbackType = Object.freeze({ Bug: 'Bug', Feature: 'Feature', General: 'General', Subscription: 'Subscription' });

/** @typedef {typeof FeedbackType[keyof typeof FeedbackType]} FeedbackTypeId */

/** Every feedback type. */
export const FEEDBACK_TYPES = /** @type {FeedbackTypeId[]} */ (Object.values(FeedbackType));

/**
 * Whether `value` is a feedback type.
 * @param {unknown} value
 * @returns {value is FeedbackTypeId}
 */
export const isFeedbackType = (value) => FEEDBACK_TYPES.some((type) => type === value);

/** Where an admin is with a piece of feedback. */
export const FeedbackStatus = Object.freeze({ Open: 'Open', Reviewed: 'Reviewed', Resolved: 'Resolved' });

/** @typedef {typeof FeedbackStatus[keyof typeof FeedbackStatus]} FeedbackStatusId */

/** Every feedback status. */
export const FEEDBACK_STATUSES = /** @type {FeedbackStatusId[]} */ (Object.values(FeedbackStatus));

/**
 * Whether `value` is a feedback status.
 * @param {unknown} value
 * @returns {value is FeedbackStatusId}
 */
export const isFeedbackStatus = (value) => FEEDBACK_STATUSES.some((status) => status === value);

/**
 * A user's subscription state. Active and Cancelled are stored; Expired is an
 * active row past its expiry, Inactive no row at all, and Admin an admin
 * without one (server/subscriptionAccess.js), all worked out when read.
 */
export const SubscriptionState = Object.freeze({
  Active: 'Active',
  Cancelled: 'Cancelled',
  Expired: 'Expired',
  Inactive: 'Inactive',
  Admin: 'Admin',
});

/** @typedef {typeof SubscriptionState[keyof typeof SubscriptionState]} SubscriptionStateId */

/** Where a scheduled job's run for a day stands (scheduled_job_runs.status). */
export const JobRunStatus = Object.freeze({ Running: 'Running', Done: 'Done', Failed: 'Failed' });

/** @typedef {typeof JobRunStatus[keyof typeof JobRunStatus]} JobRunStatusId */

/** Who started a subscription: the user activating a plan (Internal), or an admin on Admin Users. */
export const SubscriptionProvider = Object.freeze({ Internal: 'Internal', Admin: 'Admin' });

/** @typedef {typeof SubscriptionProvider[keyof typeof SubscriptionProvider]} SubscriptionProviderId */

/** How a stock setup signal ended (stock_setup_signals.status): still open, hit its target or stop, or expired. */
export const SetupOutcomeStatus = Object.freeze({ Open: 'Open', Target: 'Target', Stop: 'Stop', Expired: 'Expired' });

/** @typedef {typeof SetupOutcomeStatus[keyof typeof SetupOutcomeStatus]} SetupOutcomeStatusId */

/** A trade engine plug-in's state (server/tradeEngine/host.js), shown on Admin Services. */
export const PluginState = Object.freeze({ Stopped: 'Stopped', Running: 'Running', Failed: 'Failed' });

/** @typedef {typeof PluginState[keyof typeof PluginState]} PluginStateId */

/** A check's result: a service's health on Admin Health (server/serviceHealth.js), or a setup checklist item (OI history). */
export const HealthStatus = Object.freeze({ Pass: 'Pass', Warn: 'Warn', Fail: 'Fail' });

/** @typedef {typeof HealthStatus[keyof typeof HealthStatus]} HealthStatusId */

/** How an OI trade setup signal ended (trade_setup_signals.outcome_status); no outcome yet counts as Open. */
export const SignalOutcome = Object.freeze({ Open: 'Open', Profit: 'Profit', Loss: 'Loss' });

/** @typedef {typeof SignalOutcome[keyof typeof SignalOutcome]} SignalOutcomeId */

/** Which card the Option Analyzer's Strategy panel shows: sell setups, buy setups, or the trap analyzer. */
export const StrategyMode = Object.freeze({ Sell: 'Sell', Buy: 'Buy', Analyzer: 'Analyzer' });

/** @typedef {typeof StrategyMode[keyof typeof StrategyMode]} StrategyModeId */

/** Every strategy mode with its label. */
export const STRATEGY_MODES = /** @type {{ id: StrategyModeId, label: string }[]} */ ([
  { id: StrategyMode.Sell, label: 'Sell' },
  { id: StrategyMode.Buy, label: 'Buy' },
  { id: StrategyMode.Analyzer, label: 'Analyzer' },
]);

/** A strategy mode's label (Sell, Buy, Analyzer). */
export const strategyModeLabel = (/** @type {unknown} */ mode) => STRATEGY_MODES.find((m) => m.id === mode)?.label ?? String(mode);

/** What an admin does to a user's subscription on Admin Users (POST /api/admin/users/:userId/subscription). */
export const SubscriptionAction = Object.freeze({ Activate: 'Activate', Extend: 'Extend', Cancel: 'Cancel' });

/** @typedef {typeof SubscriptionAction[keyof typeof SubscriptionAction]} SubscriptionActionId */

/** Why a request may not use a subscription feature (server/subscriptionAccess.js). */
export const AccessDenial = Object.freeze({ Unauthenticated: 'Unauthenticated', SubscriptionRequired: 'SubscriptionRequired' });

/** @typedef {typeof AccessDenial[keyof typeof AccessDenial]} AccessDenialId */

/** The unit of a subscription plan's length (subscription_plans.duration_unit). */
export const DurationUnit = Object.freeze({ Day: 'Day', Week: 'Week', Month: 'Month', Year: 'Year' });

/** @typedef {typeof DurationUnit[keyof typeof DurationUnit]} DurationUnitId */

/** Every duration unit with its label, as read in "6 months". */
const DURATION_UNITS = /** @type {{ id: DurationUnitId, label: string }[]} */ ([
  { id: DurationUnit.Day, label: 'day' },
  { id: DurationUnit.Week, label: 'week' },
  { id: DurationUnit.Month, label: 'month' },
  { id: DurationUnit.Year, label: 'year' },
]);

/** A duration unit's label (day, week, month, year), or the value itself when unknown. */
export const durationUnitLabel = (/** @type {unknown} */ unit) => DURATION_UNITS.find((u) => u.id === unit)?.label ?? String(unit);

/** What a trade engine plug-in is (server/tradeEngine/host.js): a service, or a strategy started after the services. */
export const PluginKind = Object.freeze({ Service: 'Service', Strategy: 'Strategy' });

/** @typedef {typeof PluginKind[keyof typeof PluginKind]} PluginKindId */

/** What startup does with a migration file (server/migrationRunner.js): run its SQL, or only record it as applied. */
export const MigrationAction = Object.freeze({ Run: 'Run', Record: 'Record' });

/** @typedef {typeof MigrationAction[keyof typeof MigrationAction]} MigrationActionId */

/**
 * Which strikes an OI history fetch loads (POST /api/oi-history/fetch):
 * a range around the money, every strike already stored, or one strike.
 */
export const StrikeMode = Object.freeze({ AtmRange: 'AtmRange', AllStored: 'AllStored', Specific: 'Specific' });

/** @typedef {typeof StrikeMode[keyof typeof StrikeMode]} StrikeModeId */

/** @returns {value is StrikeModeId} */
export const isStrikeMode = (/** @type {unknown} */ value) => Object.values(StrikeMode).includes(/** @type {StrikeModeId} */ (value));

/**
 * The strike mode a request names in any letter case (browsers loaded before
 * this enum send atmRange), or the text unchanged when it names none, so the
 * fetch can refuse it.
 * @param {unknown} value
 * @returns {unknown}
 */
export const strikeModeFrom = (value) =>
  Object.values(StrikeMode).find((mode) => typeof value === 'string' && mode.toLowerCase() === value.toLowerCase()) ?? value;

/** The events an OI history fetch streams to the browser (server-sent event names). */
export const FetchEvent = Object.freeze({ Step: 'Step', Progress: 'Progress', Done: 'Done', Error: 'Error' });

/** @typedef {typeof FetchEvent[keyof typeof FetchEvent]} FetchEventId */
