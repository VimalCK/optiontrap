import crypto from 'crypto';
import { addDays, marketDateTime } from '../../shared/marketTime.js';
import { LifecycleStage, Side, TradeSource, TradingMode } from '../../shared/tradeEnums.js';
import { MAX_DRAWDOWN_SQL, RESULTS_SQL, resultsParams, toResults } from '../autoTradeResults.js';
import { sqlEnum } from '../sql.js';
import { firstRow, pool, rows } from './pool.js';

/**
 * @param {string} userId
 * @param {{ horizon: import('../shared/tradeEnums.js').HorizonId, kind: string, mode: string, tradingsymbol: string, instrumentToken: number, side: string, quantity: number }} trade
 * @param {{ strategyId: string, setup?: string | null, reason: string }} detail  why it was selected; the
 *   strategy and setup are also kept as columns, for Win/Loss Patterns
 * @returns {Promise<string>}
 */
export async function createAutoTrade(userId, trade, detail) {
  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO algo_trades (id, user_id, horizon, kind, mode, tradingsymbol, instrument_token, side, quantity, stage, strategy_id, setup)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${sqlEnum(LifecycleStage.Selected)}, $10, $11)`,
      [id, userId, trade.horizon, trade.kind, trade.mode, trade.tradingsymbol, trade.instrumentToken, trade.side, trade.quantity,
        detail.strategyId, detail.setup ?? null],
    );
    await client.query(`INSERT INTO algo_trade_events (algo_trade_id, stage, detail) VALUES ($1, ${sqlEnum(LifecycleStage.Selected)}, $2)`, [id, JSON.stringify(detail)]);
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Only a trade still at `from` moves, so a stage is never skipped or applied twice (allowed moves: canMoveTo in
 * shared/automation.js). Served by the algo_trades primary key.
 * @param {string} userId
 * @param {string} id
 * @param {string} from
 * @param {string} to
 * @param {{ reason?: string, entryPrice?: number, positionId?: string }} fields
 * @param {object} detail
 */
export async function advanceAutoTrade(userId, id, from, to, fields, detail) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query(
      `UPDATE algo_trades SET stage = $4, reason = COALESCE($5, reason), entry_price = COALESCE($6, entry_price),
         position_id = COALESCE($7, position_id), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND stage = $3`,
      [id, userId, from, to, fields.reason ?? null, fields.entryPrice ?? null, fields.positionId ?? null],
    );
    if (moved.rowCount > 0) {
      await client.query('INSERT INTO algo_trade_events (algo_trade_id, stage, detail) VALUES ($1, $2, $3)', [id, to, JSON.stringify(detail)]);
    }
    await client.query('COMMIT');
    return moved.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Served by positions_closed_idx (user_id, mode, exit_time).
 * @param {string} userId
 * @param {string} todayStart
 */
export async function getTodayAutoRealisedPnl(userId, todayStart) {
  const row = await firstRow(
    `SELECT COALESCE(SUM(CASE WHEN side = ${sqlEnum(Side.BUY)} THEN exit_price - entry_price ELSE entry_price - exit_price END * quantity
       - COALESCE(charges, 0)), 0) AS pnl
     FROM positions
     WHERE user_id = $1 AND mode = ${sqlEnum(TradingMode.Paper)} AND exited AND exit_time >= $2 AND source = ${sqlEnum(TradeSource.Auto)}`,
    [userId, todayStart],
  );
  return Number(row.pnl);
}

/**
 * For the Wait after exit entry rule. Served by positions_closed_idx (user_id, mode, exit_time).
 * @param {string} userId
 * @param {string} todayStart
 * @returns {Promise<{ instrumentToken: number, exitTime: Date }[]>}
 */
export async function getTodayAutoExits(userId, todayStart) {
  const result = await rows(
    `SELECT instrument_token, MAX(exit_time) AS exit_time
     FROM positions
     WHERE user_id = $1 AND mode = ${sqlEnum(TradingMode.Paper)} AND exited AND exit_time >= $2 AND source = ${sqlEnum(TradeSource.Auto)}
     GROUP BY instrument_token`,
    [userId, todayStart],
  );
  return result.map((row) => ({ instrumentToken: Number(row.instrument_token), exitTime: new Date(row.exit_time) }));
}

/**
 * The executed automated trades behind a position: what closing it closes. Served by algo_trades_position_idx.
 * @returns {Promise<{ id: string, side: string, quantity: number, entryPrice: number | null, createdAt: unknown }[]>}
 */
export async function getExecutedAutoTrades(userId, positionId) {
  const result = await rows(
    `SELECT id, side, quantity, entry_price, created_at FROM algo_trades
     WHERE position_id = $1 AND user_id = $2 AND stage = ${sqlEnum(LifecycleStage.Executed)}`,
    [positionId, userId],
  );
  return result.map((row) => ({ id: row.id, side: row.side, quantity: Number(row.quantity), entryPrice: row.entry_price, createdAt: row.created_at }));
}

/**
 * Closes the given executed trades of a position, each with its own charges, and records a closed event for each.
 * One transaction, so a trade is never closed without its event; a trade no longer executed is left alone.
 * Served by algo_trades_position_idx.
 * @param {string} userId
 * @param {string} positionId
 * @param {{ id: string, charges: number }[]} trades
 * @param {number} exitPrice
 * @param {{ ruleId: string | null, reason: string }} detail  ruleId is null for a manual exit
 * @returns {Promise<string[]>} the ids closed
 */
export async function closeAutoTrades(userId, positionId, trades, exitPrice, detail) {
  if (trades.length === 0) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const closed = await client.query(
      `UPDATE algo_trades t SET stage = ${sqlEnum(LifecycleStage.Closed)}, exit_price = $3, reason = $4, exit_rule_id = $5, charges = c.charges, updated_at = now()
       FROM unnest($6::text[], $7::numeric[]) AS c (id, charges)
       WHERE t.id = c.id AND t.position_id = $1 AND t.user_id = $2 AND t.stage = ${sqlEnum(LifecycleStage.Executed)}
       RETURNING t.id`,
      [positionId, userId, exitPrice, detail.reason, detail.ruleId, trades.map((trade) => trade.id), trades.map((trade) => trade.charges)],
    );
    const ids = closed.rows.map((row) => row.id);
    if (ids.length > 0) {
      await client.query(
        `INSERT INTO algo_trade_events (algo_trade_id, stage, detail)
         SELECT id, ${sqlEnum(LifecycleStage.Closed)}, $2 FROM unnest($1::text[]) AS id`,
        [ids, JSON.stringify({ ...detail, exitPrice })],
      );
    }
    await client.query('COMMIT');
    return ids;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function toAutoTrade(row) {
  return {
    id: row.id,
    horizon: row.horizon,
    kind: row.kind,
    mode: row.mode,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: Number(row.instrument_token),
    side: row.side,
    quantity: Number(row.quantity),
    stage: row.stage,
    reason: row.reason,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    charges: row.charges == null ? null : Number(row.charges),
    positionId: row.position_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    events: (row.events ?? []).map((e) => ({ stage: e.stage, at: e.at, detail: e.detail })),
  };
}

/** Served by algo_trades_user_created_idx (user_id, created_at DESC). */
export async function getAutoTrades(userId, { from, to }) {
  const result = await rows(
    `SELECT t.*,
       COALESCE((SELECT json_agg(json_build_object('stage', e.stage, 'at', e.at, 'detail', e.detail) ORDER BY e.at, e.id)
                 FROM algo_trade_events e WHERE e.algo_trade_id = t.id), '[]'::json) AS events
     FROM algo_trades t
     WHERE t.user_id = $1 AND t.created_at >= $2 AND t.created_at < $3
     ORDER BY t.created_at DESC`,
    [userId, marketDateTime(from).toISOString(), marketDateTime(addDays(to, 1)).toISOString()],
  );
  return result.map(toAutoTrade);
}

/** Served by algo_trades_user_closed_idx. */
export async function getAutoTradeResults(userId, range) {
  const params = resultsParams(userId, range);
  const [groups, drawdown] = await Promise.all([rows(RESULTS_SQL, params), firstRow(MAX_DRAWDOWN_SQL, params)]);
  return toResults(groups, drawdown.max_drawdown);
}
