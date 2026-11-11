/**
 * Request parsing and SQL for the positions endpoints, kept free of the
 * database driver so it can be unit-tested.
 *
 *   GET /api/positions                 open positions plus today's exits
 *   GET /api/positions?status=closed   exited positions, filtered and paged
 *   GET /api/positions/daily-pnl       P&L and trade count per exit day
 *   GET /api/positions/stats           all-time win/loss figures
 *
 * Dates in requests are market-zone (IST) days, 'YYYY-MM-DD', matched against
 * the exit time. exit_time is stored as an ISO-8601 UTC string, which sorts
 * chronologically, so comparing it as text against the ISO instants of
 * market-zone midnights selects whole market days.
 */
import { MARKET_TIME_ZONE, addDays, marketDateTime } from '../shared/marketTime.js';

export const POSITION_STATUSES = ['closed'];
export const POSITION_MODES = ['paper', 'live'];
export const SEGMENTS = ['options', 'futures', 'stocks'];
export const DEFAULT_TRADE_LIMIT = 100;
export const MAX_TRADE_LIMIT = 500;

// P&L of an exited position after its charges (shared/paperCharges.js; none on positions closed
// before charges were recorded); the same formula as the browser's positionToEntry.
/** A position's charges; 0 for one closed before charges were kept. */
const CHARGES_SQL = 'COALESCE(charges, 0)';
const PNL_SQL = `(CASE WHEN side = 'BUY' THEN (exit_price - entry_price) * quantity ELSE (entry_price - exit_price) * quantity END - ${CHARGES_SQL})`;
// By instrument_type, which every position has (option_type is NULL for stocks
// and futures, and NOT IN never matches NULL).
const SEGMENT_SQL = {
  options: "instrument_type IN ('CE', 'PE')",
  futures: "instrument_type = 'FUT'",
  stocks: "instrument_type = 'EQ'",
};

const isDate = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;

/** Parse a whole number from a query value; undefined when left out, NaN when bad. */
function toInt(value) {
  if (value === undefined) return undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
}

function parseMode(mode) {
  if (mode === undefined) return { mode: null };
  return POSITION_MODES.includes(mode) ? { mode } : { error: `mode must be one of: ${POSITION_MODES.join(', ')}` };
}

function parseSegment(segment) {
  if (segment === undefined) return { segment: undefined };
  return SEGMENTS.includes(segment) ? { segment } : { error: `segment must be one of: ${SEGMENTS.join(', ')}` };
}

/** A from/to date range (YYYY-MM-DD, market days) from a query; `required` makes both mandatory. */
export function parseRange(from, to, { required }) {
  if (required && (from === undefined || to === undefined)) return { error: 'from and to are required' };
  if (from !== undefined && !isDate(from)) return { error: 'from must be a date, YYYY-MM-DD' };
  if (to !== undefined && !isDate(to)) return { error: 'to must be a date, YYYY-MM-DD' };
  if (from !== undefined && to !== undefined && from > to) return { error: 'from must not be after to' };
  return { from, to };
}

/**
 * Validate the query of GET /api/positions.
 * @returns {{ filter: object } | { error: string }}
 */
export function parsePositionsQuery(query = {}) {
  const { status } = query;
  if (status !== undefined && !POSITION_STATUSES.includes(status)) {
    return { error: `status must be one of: ${POSITION_STATUSES.join(', ')}` };
  }
  const mode = parseMode(query.mode);
  if (mode.error) return mode;

  if (status !== 'closed') {
    const closedOnly = ['from', 'to', 'segment', 'limit', 'offset'].filter((key) => query[key] !== undefined);
    if (closedOnly.length) return { error: `${closedOnly.join(', ')} can only be used with status=closed` };
    return { filter: { mode: mode.mode } };
  }

  const range = parseRange(query.from, query.to, { required: false });
  if (range.error) return range;
  const segment = parseSegment(query.segment);
  if (segment.error) return segment;

  const limit = toInt(query.limit) ?? DEFAULT_TRADE_LIMIT;
  if (Number.isNaN(limit) || limit < 1 || limit > MAX_TRADE_LIMIT) {
    return { error: `limit must be a whole number from 1 to ${MAX_TRADE_LIMIT}` };
  }
  const offset = toInt(query.offset) ?? 0;
  if (Number.isNaN(offset)) return { error: 'offset must be a whole number' };

  return {
    filter: { mode: mode.mode, status, from: range.from, to: range.to, segment: segment.segment, limit, offset },
  };
}

/**
 * Validate the query of GET /api/positions/daily-pnl. from and to are
 * required; the reply is one row per day with exits, however many trades
 * there are.
 * @returns {{ filter: object } | { error: string }}
 */
export function parseDailyPnlQuery(query = {}) {
  const mode = parseMode(query.mode);
  if (mode.error) return mode;
  const range = parseRange(query.from, query.to, { required: true });
  if (range.error) return range;
  const segment = parseSegment(query.segment);
  if (segment.error) return segment;
  return { filter: { mode: mode.mode, from: range.from, to: range.to, segment: segment.segment } };
}

/** Validate the query of GET /api/positions/stats. */
export function parseStatsQuery(query = {}) {
  const mode = parseMode(query.mode);
  if (mode.error) return mode;
  return { filter: { mode: mode.mode } };
}

/** Collects conditions and numbered parameters for one query. */
function whereBuilder(userId) {
  const params = [userId];
  const conditions = ['user_id = $1'];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  return { params, conditions, param };
}

/** Conditions shared by every query over exited positions. */
function closedConditions({ conditions, param }, { mode, from, to, segment }) {
  if (mode) conditions.push(`mode = ${param(mode)}`);
  conditions.push('exited = 1', 'exit_price IS NOT NULL');
  if (from) conditions.push(`exit_time >= ${param(marketDateTime(from).toISOString())}`);
  if (to) conditions.push(`exit_time < ${param(marketDateTime(addDays(to, 1)).toISOString())}`);
  if (segment) conditions.push(SEGMENT_SQL[segment]);
}

/**
 * SQL for GET /api/positions.
 * @param {string} userId
 * @param {object} filter from parsePositionsQuery, plus todayStart: the ISO
 *   instant of today's market-zone midnight (used without status=closed).
 * @returns {{ sql: string, params: unknown[] }}
 */
export function buildPositionsQuery(userId, { mode = null, status, from, to, segment, limit, offset, todayStart }) {
  const where = whereBuilder(userId);

  if (status !== 'closed') {
    if (mode) where.conditions.push(`mode = ${where.param(mode)}`);
    where.conditions.push(`(exited = 0 OR exit_time >= ${where.param(todayStart)})`);
    const sql = `SELECT * FROM positions WHERE ${where.conditions.join(' AND ')} ORDER BY entry_time DESC`;
    return { sql, params: where.params };
  }

  closedConditions(where, { mode, from, to, segment });
  // id breaks ties so paging with offset never skips or repeats a row.
  const sql = `SELECT * FROM positions WHERE ${where.conditions.join(' AND ')} `
    + `ORDER BY exit_time DESC, id DESC LIMIT ${where.param(limit ?? DEFAULT_TRADE_LIMIT)} OFFSET ${where.param(offset ?? 0)}`;
  return { sql, params: where.params };
}

/**
 * SQL for GET /api/positions/daily-pnl: one row per market-zone exit day,
 * newest first, with columns date ('YYYY-MM-DD'), pnl and trades.
 */
export function buildDailyPnlQuery(userId, { mode = null, from, to, segment }) {
  const where = whereBuilder(userId);
  closedConditions(where, { mode, from, to, segment });
  const day = `to_char((exit_time::timestamptz) AT TIME ZONE ${where.param(MARKET_TIME_ZONE)}, 'YYYY-MM-DD')`;
  const sql = `SELECT ${day} AS date, ROUND(SUM(${PNL_SQL})::numeric, 2) AS pnl, ROUND(SUM(${CHARGES_SQL})::numeric, 2) AS charges, COUNT(*) AS trades `
    + `FROM positions WHERE ${where.conditions.join(' AND ')} GROUP BY 1 ORDER BY 1 DESC`;
  return { sql, params: where.params };
}

/**
 * SQL for GET /api/positions/stats, as three queries:
 *   summary: closed_trades, winning_trades, losing_trades, avg_win, avg_loss, today_trades
 *   best / worst: the single position with the highest / lowest P&L (latest exit wins ties)
 * @param {string} userId
 * @param {{ mode?: string | null, todayStart: string }} options
 */
export function buildStatsQueries(userId, { mode = null, todayStart }) {
  const summaryWhere = whereBuilder(userId);
  closedConditions(summaryWhere, { mode });
  const summary = {
    sql: 'SELECT COUNT(*) AS closed_trades, '
      + 'COUNT(*) FILTER (WHERE pnl > 0) AS winning_trades, '
      + 'COUNT(*) FILTER (WHERE pnl < 0) AS losing_trades, '
      + 'AVG(pnl) FILTER (WHERE pnl > 0) AS avg_win, '
      + 'AVG(pnl) FILTER (WHERE pnl < 0) AS avg_loss, '
      + `COUNT(*) FILTER (WHERE exit_time >= ${summaryWhere.param(todayStart)}) AS today_trades `
      + `FROM (SELECT ${PNL_SQL} AS pnl, exit_time FROM positions WHERE ${summaryWhere.conditions.join(' AND ')}) AS closed`,
    params: summaryWhere.params,
  };

  const extreme = (direction) => {
    const where = whereBuilder(userId);
    closedConditions(where, { mode });
    return {
      sql: `SELECT * FROM positions WHERE ${where.conditions.join(' AND ')} ORDER BY ${PNL_SQL} ${direction}, exit_time DESC LIMIT 1`,
      params: where.params,
    };
  };

  return { summary, best: extreme('DESC'), worst: extreme('ASC') };
}
