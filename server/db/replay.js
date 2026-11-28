import crypto from 'crypto';
import { ReplaySessionStatus } from '../../shared/appEnums.js';
import { firstRow, rows } from './pool.js';

const SESSION_COLUMNS = 'id, underlying, trade_date, expiry, lot_size, attempt, started_at, finished_at, trade_count, net';

function toReplaySession(row) {
  return {
    id: row.id,
    underlying: row.underlying,
    date: row.trade_date,
    expiry: row.expiry,
    lotSize: row.lot_size,
    attempt: row.attempt,
    status: row.finished_at ? ReplaySessionStatus.Finished : ReplaySessionStatus.Open,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    tradeCount: row.trade_count,
    net: row.net,
  };
}

const TRADE_COLUMNS = `id, session_id, option_type, strike, tradingsymbol, lots, quantity, click_time, entry_time, exit_time,
  entry_price, exit_price, points, charges, net, exit_reason, reasons, note`;

function toReplayTrade(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    optionType: row.option_type,
    strike: row.strike,
    tradingsymbol: row.tradingsymbol,
    lots: row.lots,
    quantity: row.quantity,
    clickTime: row.click_time,
    entryTime: row.entry_time,
    exitTime: row.exit_time,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    points: row.points,
    charges: row.charges,
    net: row.net,
    exitReason: row.exit_reason,
    reasons: row.reasons,
    note: row.note ?? null,
  };
}

/** A new session for the user's next playthrough of an underlying's day (attempt 1 the first time). */
export async function createReplaySession(userId, { underlying, date, expiry, lotSize }) {
  const row = await firstRow(
    `INSERT INTO replay_sessions (id, user_id, underlying, trade_date, expiry, lot_size, attempt)
     SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(attempt), 0) + 1
     FROM replay_sessions WHERE user_id = $2 AND underlying = $3 AND trade_date = $4
     RETURNING ${SESSION_COLUMNS}`,
    [crypto.randomUUID(), userId, underlying, date, expiry, lotSize],
  );
  return toReplaySession(row);
}

/** The user's open session by id, or null when it isn't theirs or has finished. */
export async function getOpenReplaySession(id, userId) {
  const row = await firstRow(
    `SELECT ${SESSION_COLUMNS} FROM replay_sessions WHERE id = $1 AND user_id = $2 AND finished_at IS NULL`,
    [id, userId],
  );
  return row ? toReplaySession(row) : null;
}

/** Marks the user's open session finished with its trades' totals; null when it isn't theirs or already finished. */
export async function finishReplaySession(id, userId) {
  const row = await firstRow(
    `UPDATE replay_sessions s
     SET finished_at = now(),
         trade_count = t.trade_count,
         net = t.net
     FROM (SELECT COUNT(*)::int AS trade_count, COALESCE(SUM(net), 0) AS net FROM replay_trades WHERE session_id = $1) t
     WHERE s.id = $1 AND s.user_id = $2 AND s.finished_at IS NULL
     RETURNING ${SESSION_COLUMNS.split(', ').map((column) => `s.${column}`).join(', ')}`,
    [id, userId],
  );
  return row ? toReplaySession(row) : null;
}

/** The user's sessions whose day is in [from, to], optionally of one underlying, by day then attempt. */
export async function getReplaySessions(userId, { from, to, underlying = null }) {
  const result = await rows(
    `SELECT ${SESSION_COLUMNS} FROM replay_sessions
     WHERE user_id = $1 AND trade_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR underlying = $4)
     ORDER BY trade_date, underlying, attempt`,
    [userId, from, to, underlying],
  );
  return result.map(toReplaySession);
}

/**
 * Records a finished trade in the user's open session; null when the session isn't theirs or has finished.
 * The result (points, charges, net) and quantity are worked out by the caller.
 */
export async function addReplayTrade(userId, sessionId, trade) {
  const row = await firstRow(
    `INSERT INTO replay_trades (id, session_id, user_id, underlying, trade_date, attempt, option_type, strike, tradingsymbol,
       lots, quantity, click_time, entry_time, exit_time, entry_price, exit_price, points, charges, net, exit_reason, reasons, note, context)
     SELECT $1, s.id, s.user_id, s.underlying, s.trade_date, s.attempt, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
     FROM replay_sessions s WHERE s.id = $2 AND s.user_id = $3 AND s.finished_at IS NULL
     RETURNING ${TRADE_COLUMNS}`,
    [crypto.randomUUID(), sessionId, userId, trade.optionType, trade.strike, trade.tradingsymbol, trade.lots, trade.quantity,
      trade.clickTime, trade.entryTime, trade.exitTime, trade.entryPrice, trade.exitPrice, trade.points, trade.charges, trade.net,
      trade.exitReason, trade.reasons, trade.note, trade.context],
  );
  return row ? toReplayTrade(row) : null;
}

const STATS_FILTER = 'user_id = $1 AND attempt = 1 AND trade_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR underlying = $4)';
const GROUP_TOTALS = `COUNT(*)::int AS trades, COUNT(*) FILTER (WHERE net > 0)::int AS wins, COALESCE(SUM(net), 0) AS net,
  COALESCE(AVG(net), 0) AS average_net`;

const toGroup = (row) => ({ key: row.key, trades: row.trades, wins: row.wins, net: row.net, averageNet: Math.round(row.average_net * 100) / 100 });

/**
 * Results of the user's first-attempt replay trades whose day is in [from, to], optionally of one underlying:
 * totals, then grouped by reason tag (a trade counts under each of its tags; untagged ones under null), by entry hour
 * and by option type. Hold time is the average minutes between entry and exit.
 */
export async function getReplayStats(userId, { from, to, underlying = null }) {
  const params = [userId, from, to, underlying];
  const [totals, byReason, byHour, byOptionType] = await Promise.all([
    firstRow(
      `SELECT ${GROUP_TOTALS}, COUNT(DISTINCT session_id)::int AS sessions,
         COALESCE(SUM(charges), 0) AS charges,
         COALESCE(AVG((substr(exit_time, 1, 2)::int * 60 + substr(exit_time, 4, 2)::int)
                    - (substr(entry_time, 1, 2)::int * 60 + substr(entry_time, 4, 2)::int)), 0) AS average_hold_minutes
       FROM replay_trades WHERE ${STATS_FILTER}`,
      params,
    ),
    rows(
      `SELECT reason AS key, ${GROUP_TOTALS}
       FROM replay_trades LEFT JOIN LATERAL unnest(NULLIF(reasons, '{}')) AS reason ON true
       WHERE ${STATS_FILTER} GROUP BY reason ORDER BY net DESC`,
      params,
    ),
    rows(`SELECT substr(entry_time, 1, 2) AS key, ${GROUP_TOTALS} FROM replay_trades WHERE ${STATS_FILTER} GROUP BY 1 ORDER BY 1`, params),
    rows(`SELECT option_type AS key, ${GROUP_TOTALS} FROM replay_trades WHERE ${STATS_FILTER} GROUP BY 1 ORDER BY 1`, params),
  ]);
  return {
    trades: totals.trades,
    wins: totals.wins,
    net: totals.net,
    averageNet: Math.round(totals.average_net * 100) / 100,
    charges: totals.charges,
    sessions: totals.sessions,
    averageHoldMinutes: Math.round(totals.average_hold_minutes * 10) / 10,
    byReason: byReason.map(toGroup),
    byHour: byHour.map(toGroup),
    byOptionType: byOptionType.map(toGroup),
  };
}
