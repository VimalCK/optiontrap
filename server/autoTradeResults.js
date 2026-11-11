/**
 * SQL and row mapping for GET /api/automation/results (Win/Loss Patterns in
 * Analytics), kept free of the database driver so it can be unit-tested.
 *
 * It measures a user's closed automated trades entered in a range of market
 * (IST) days: a summary, the same figures grouped by strategy, setup, exit
 * rule, entry time (30-minute IST slots), side and entry day, and the max
 * drawdown. All grouping happens in SQL (one GROUPING SETS scan), so the
 * browser gets totals, never the trades. A trade's P&L is
 * (exit − entry) × quantity, sign flipped for a sell, minus its own charges
 * (shared/paperCharges.js; none for trades closed before charges were kept).
 * Served by algo_trades_user_closed_idx (user_id, created_at) WHERE closed.
 */
import { MARKET_TIME_ZONE, addDays, marketDateTime } from '../shared/marketTime.js';
import { RESULTS_ENTRY_SLOT_MINUTES as SLOT } from '../shared/automation.js';

// $1 user, $2/$3 the range's ISO instants, $4 the market time zone.
const CLOSED_TRADES_SQL = `
  SELECT id, strategy_id, setup, exit_rule_id, side, updated_at,
    to_char(created_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
    (EXTRACT(HOUR FROM created_at AT TIME ZONE $4) * 60
      + FLOOR(EXTRACT(MINUTE FROM created_at AT TIME ZONE $4) / ${SLOT}) * ${SLOT})::int AS slot,
    COALESCE(charges, 0) AS charges,
    CASE WHEN side = 'BUY' THEN exit_price - entry_price ELSE entry_price - exit_price END * quantity - COALESCE(charges, 0) AS pnl
  FROM algo_trades
  WHERE user_id = $1 AND stage = 'closed' AND created_at >= $2 AND created_at < $3`;

// Which column each GROUPING SETS row is grouped by ('all' is the summary).
// Each row groups by one column at most, so COALESCE picks its value.
export const RESULTS_SQL = `
  WITH closed AS (${CLOSED_TRADES_SQL})
  SELECT
    CASE WHEN GROUPING(strategy_id) = 0 THEN 'strategy' WHEN GROUPING(setup) = 0 THEN 'setup'
         WHEN GROUPING(exit_rule_id) = 0 THEN 'exitRule' WHEN GROUPING(slot) = 0 THEN 'entrySlot'
         WHEN GROUPING(side) = 0 THEN 'side' WHEN GROUPING(day) = 0 THEN 'day' ELSE 'all' END AS dimension,
    COALESCE(strategy_id, setup, exit_rule_id, slot::text, side, day) AS key,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE pnl > 0) AS wins,
    COUNT(*) FILTER (WHERE pnl < 0) AS losses,
    COALESCE(SUM(pnl), 0) AS pnl,
    COALESCE(SUM(pnl) FILTER (WHERE pnl > 0), 0) AS gross_profit,
    COALESCE(-SUM(pnl) FILTER (WHERE pnl < 0), 0) AS gross_loss,
    MAX(pnl) AS best,
    MIN(pnl) AS worst,
    COALESCE(SUM(charges), 0) AS charges
  FROM closed
  GROUP BY GROUPING SETS ((), (strategy_id), (setup), (exit_rule_id), (slot), (side), (day))`;

// The largest fall from a peak of the running P&L, trade by trade in exit
// order, counting from zero (a first losing trade is a drawdown too).
export const MAX_DRAWDOWN_SQL = `
  WITH closed AS (${CLOSED_TRADES_SQL}),
  running AS (SELECT updated_at, id, SUM(pnl) OVER (ORDER BY updated_at, id) AS total FROM closed),
  peaks AS (SELECT total, GREATEST(0, MAX(total) OVER (ORDER BY updated_at, id)) AS peak FROM running)
  SELECT COALESCE(MAX(peak - total), 0) AS max_drawdown FROM peaks`;

/**
 * One group's figures. `key` is the strategy id, setup, exit rule id (null:
 * exited manually), entry slot (minutes after IST midnight), side or day.
 * @typedef {{ key: string | number | null, trades: number, wins: number, losses: number, pnl: number,
 *             grossProfit: number, grossLoss: number, best: number | null, worst: number | null,
 *             charges: number }} ResultGroup
 */

/** Each GROUPING SETS dimension and the reply field it fills. */
const DIMENSIONS = {
  strategy: 'byStrategy', setup: 'bySetup', exitRule: 'byExitRule', entrySlot: 'byEntrySlot', side: 'bySide', day: 'byDay',
};

/** @returns {ResultGroup} */
function toGroup(row) {
  return {
    key: row.dimension === 'entrySlot' ? Number(row.key) : row.key,
    trades: Number(row.trades),
    wins: Number(row.wins),
    losses: Number(row.losses),
    pnl: Number(row.pnl),
    grossProfit: Number(row.gross_profit),
    grossLoss: Number(row.gross_loss),
    best: row.best == null ? null : Number(row.best),
    worst: row.worst == null ? null : Number(row.worst),
    charges: Number(row.charges ?? 0),
  };
}

const EMPTY_SUMMARY = toGroup({ dimension: 'all', key: null, trades: 0, wins: 0, losses: 0, pnl: 0, gross_profit: 0, gross_loss: 0, charges: 0 });

/**
 * The reply from the two queries' rows: the summary, max drawdown, and each
 * breakdown — time and day in order, the others by P&L, best first.
 */
export function toResults(groupRows, maxDrawdown) {
  /** @type {Record<string, ResultGroup[]>} */
  const groups = Object.fromEntries(Object.values(DIMENSIONS).map((field) => [field, []]));
  let summary = EMPTY_SUMMARY;
  for (const row of groupRows) {
    if (row.dimension === 'all') summary = toGroup(row);
    else groups[DIMENSIONS[row.dimension]].push(toGroup(row));
  }
  const byPnl = (/** @type {ResultGroup} */ a, /** @type {ResultGroup} */ b) => b.pnl - a.pnl;
  const byKey = (/** @type {ResultGroup} */ a, /** @type {ResultGroup} */ b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return {
    summary,
    maxDrawdown: Number(maxDrawdown),
    byStrategy: groups.byStrategy.sort(byPnl),
    bySetup: groups.bySetup.sort(byPnl),
    byExitRule: groups.byExitRule.sort(byPnl),
    byEntrySlot: groups.byEntrySlot.sort(byKey),
    bySide: groups.bySide.sort(byPnl),
    byDay: groups.byDay.sort(byKey),
  };
}

/** The query parameters for a range of market days (inclusive). */
export function resultsParams(userId, { from, to }) {
  return [userId, marketDateTime(from).toISOString(), marketDateTime(addDays(to, 1)).toISOString(), MARKET_TIME_ZONE];
}
