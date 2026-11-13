import crypto from 'crypto';
import { addDays, marketDateTime } from '../../shared/marketTime.js';
import { oppositeSide, OrderStatus, OrderType, TradeSource } from '../../shared/tradeEnums.js';
import { sqlEnum } from '../sql.js';
import { firstRow, query, rows } from './pool.js';
import { instrumentColumns, positionMetaValues } from './positions.js';

function toOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: Number(row.instrument_token),
    instrumentType: row.instrument_type,
    exchange: row.exchange,
    strike: row.strike,
    optionType: row.option_type,
    expiry: row.expiry,
    side: row.side,
    quantity: Number(row.quantity),
    orderType: row.order_type,
    /** null for a market order. */
    limitPrice: row.limit_price,
    note: row.note || '',
    targetPrice: row.target_price,
    stopLossPrice: row.stop_loss_price,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    status: row.status,
    statusReason: row.status_reason,
    fillPrice: row.fill_price,
    /** The position it opened or added to; for a closing order, the position it closed. */
    positionId: row.position_id,
    /** Whether it closes a position (an exit) rather than opening or adding to one. */
    closesPosition: row.closes_position,
    source: row.source,
    horizon: row.horizon,
    autoTradeId: row.algo_trade_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Who placed it is set by the caller, never read from the order: by hand (Manual), or by the trade engine for an
 * automated trade (Auto, with that trade's id).
 * @param {string} userId
 * @param {import('../shared/orders.js').Order} order
 * @param {{ source?: import('../shared/tradeEnums.js').TradeSourceId, autoTradeId?: string | null }} [placedBy]
 */
export async function createOrder(userId, order, { source = TradeSource.Manual, autoTradeId = null } = {}) {
  const { strike, optionType, expiry } = instrumentColumns(order);
  const row = await firstRow(
    `INSERT INTO orders (id, user_id, tradingsymbol, instrument_token, instrument_type, exchange, strike, option_type, expiry,
       side, quantity, order_type, limit_price, note, target_price, stop_loss_price, confidence, source, algo_trade_id, horizon)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [crypto.randomUUID(), userId, order.tradingsymbol, order.instrumentToken, order.instrumentType, order.exchange, strike, optionType, expiry,
     order.side, order.quantity, order.orderType, order.limitPrice, ...positionMetaValues(order), source, autoTradeId, order.horizon],
  );
  return toOrder(row);
}

/**
 * Who placed it is set by the caller: by hand (Manual) or an exit rule (Auto).
 * @param {string} userId
 * @param {{ id: string, tradingsymbol: string, instrumentToken: number, instrumentType: string, exchange: string,
 *           strike: number | null, optionType: string | null, expiry: string | null, side: string, quantity: number,
 *           horizon: import('../shared/tradeEnums.js').HorizonId }} position  the position it closed
 * @param {number} fillPrice
 * @param {import('../shared/tradeEnums.js').TradeSourceId} source
 */
export async function recordClosingOrder(userId, position, fillPrice, source) {
  const row = await firstRow(
    `INSERT INTO orders (id, user_id, tradingsymbol, instrument_token, instrument_type, exchange, strike, option_type, expiry,
       side, quantity, order_type, limit_price, status, fill_price, position_id, closes_position, source, horizon)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${sqlEnum(OrderType.Market)}, NULL, ${sqlEnum(OrderStatus.Filled)}, $12, $13, true, $14, $15)
     RETURNING *`,
    [crypto.randomUUID(), userId, position.tradingsymbol, position.instrumentToken, position.instrumentType, position.exchange,
     position.strike, position.optionType, position.expiry, oppositeSide(position.side), position.quantity,
     fillPrice, position.id, source, position.horizon],
  );
  return toOrder(row);
}

/**
 * Each counts as the position it will open, for the entry rules. Served by orders_open_auto_idx.
 * @param {string} userId
 * @returns {Promise<{ instrumentToken: number }[]>}
 */
export async function getWaitingAutoOrders(userId) {
  const result = await rows(`SELECT instrument_token FROM orders WHERE user_id = $1 AND status = ${sqlEnum(OrderStatus.Open)} AND source = ${sqlEnum(TradeSource.Auto)}`, [userId]);
  return result.map((row) => ({ instrumentToken: Number(row.instrument_token) }));
}

/** Served by orders_user_created_idx (user_id, created_at DESC). */
export async function getOrders(userId, { from, to }) {
  const result = await rows(
    `SELECT * FROM orders
     WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
     ORDER BY created_at DESC`,
    [userId, marketDateTime(from).toISOString(), marketDateTime(addDays(to, 1)).toISOString()],
  );
  return result.map(toOrder);
}

/** Served by orders_user_open_idx. */
export async function getUserOpenOrders(userId) {
  const result = await rows(`SELECT * FROM orders WHERE user_id = $1 AND status = ${sqlEnum(OrderStatus.Open)} ORDER BY created_at DESC`, [userId]);
  return result.map(toOrder);
}

/** Served by orders_open_idx. */
export async function getOpenOrders(since) {
  const result = await rows(`SELECT * FROM orders WHERE status = ${sqlEnum(OrderStatus.Open)} AND created_at >= $1 ORDER BY created_at`, [since]);
  return result.map(toOrder);
}

/** Only if still open, so an order fills once even when a cancel or another tick races it. Served by the primary key. */
export async function claimOrderFill(id, fillPrice) {
  const row = await firstRow(
    `UPDATE orders SET status = ${sqlEnum(OrderStatus.Filled)}, fill_price = $2, updated_at = now()
     WHERE id = $1 AND status = ${sqlEnum(OrderStatus.Open)}
     RETURNING *`,
    [id, fillPrice],
  );
  return row ? toOrder(row) : null;
}

/** Link a filled order to the position it opened. Served by the primary key. */
export async function setOrderPosition(id, positionId) {
  await query('UPDATE orders SET position_id = $2, updated_at = now() WHERE id = $1', [id, positionId]);
}

/** For an order claimed for a fill whose trade was then refused (e.g. the market closed in between). Served by the primary key. */
export async function cancelUnfilledOrder(id, reason) {
  const row = await firstRow(
    `UPDATE orders SET status = ${sqlEnum(OrderStatus.Cancelled)}, status_reason = $2, fill_price = NULL, updated_at = now()
     WHERE id = $1 AND status = ${sqlEnum(OrderStatus.Filled)} AND position_id IS NULL
     RETURNING *`,
    [id, reason],
  );
  return row ? toOrder(row) : null;
}

/** Served by the primary key. */
export async function cancelOrder(userId, id, reason) {
  const row = await firstRow(
    `UPDATE orders SET status = ${sqlEnum(OrderStatus.Cancelled)}, status_reason = $3, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = ${sqlEnum(OrderStatus.Open)}
     RETURNING *`,
    [id, userId, reason],
  );
  return row ? toOrder(row) : null;
}

/** Run at the market close, and for any order left open from an earlier day. Served by orders_open_idx. */
export async function cancelOpenOrdersPlacedBefore(before, reason) {
  const result = await rows(
    `UPDATE orders SET status = ${sqlEnum(OrderStatus.Cancelled)}, status_reason = $2, updated_at = now()
     WHERE status = ${sqlEnum(OrderStatus.Open)} AND created_at < $1
     RETURNING *`,
    [before, reason],
  );
  return result.map(toOrder);
}
