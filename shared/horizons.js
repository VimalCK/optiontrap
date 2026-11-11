/**
 * Trade horizons: whether a trade is intraday (closed the same day) or
 * positional (held over days). Every paper position, limit order and
 * automated trade carries one (`horizon` on positions, orders and
 * algo_trades), so the trade monitor knows which positions to square off
 * (shared/exitRules/squareOff.js) and trades merge only with a position of the
 * same horizon (server/db.js).
 *
 * An enum, like C#'s `enum Horizon { Intraday = 1, Positional = 2 }`: code
 * names a horizon by its member (`Horizon.Intraday`), and the number is what
 * the database stores, the API sends and the automation config keys its
 * switches by. A member can be renamed without touching stored rows; a number
 * never changes once used.
 *
 * Kept apart from shared/automation.js (which re-exports HORIZONS) because the
 * paper trade rules and the exit rules need it too, and automation.js imports
 * the exit rules.
 */

/** Every horizon, by name. */
export const Horizon = Object.freeze({
  Intraday: 1,
  Positional: 2,
});

/**
 * A horizon's number (1 intraday, 2 positional).
 * @typedef {typeof Horizon[keyof typeof Horizon]} HorizonId
 */

/**
 * Every horizon, in display order, with its label. `available` says whether
 * the trade automation can take trades on it yet (positional trades will
 * follow OI history and are not built); a manual trade can use either.
 * @type {{ id: HorizonId, label: string, available: boolean }[]}
 */
export const HORIZONS = [
  { id: Horizon.Intraday, label: 'Intraday', available: true },
  { id: Horizon.Positional, label: 'Positional', available: false },
];

/**
 * Whether `value` is a horizon.
 * @param {unknown} value
 * @returns {value is HorizonId}
 */
export const isHorizon = (value) => HORIZONS.some((h) => h.id === value);

/** A horizon's label (Intraday, Positional), or the value itself when unknown. */
export const horizonLabel = (/** @type {unknown} */ horizon) => HORIZONS.find((h) => h.id === horizon)?.label ?? String(horizon);
