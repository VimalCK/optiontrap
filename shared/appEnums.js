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
