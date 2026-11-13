import crypto from 'crypto';
import { Horizon, InstrumentType, isOptionType, TradeSource, TradingMode } from '../../shared/tradeEnums.js';
import { buildDailyPnlQuery, buildPositionsQuery, buildStatsQueries } from '../positionsQuery.js';
import { sqlEnum } from '../sql.js';
import { firstRow, getTodayMidnight, rows } from './pool.js';

/**
 * Served by positions_open_intraday_idx.
 * @param {string} before  ISO timestamp
 */
export async function getOpenIntradayPositionsBefore(before) {
  const result = await rows(
    'SELECT * FROM positions WHERE NOT exited AND mode = $1 AND horizon = $2 AND entry_time < $3 ORDER BY entry_time',
    [TradingMode.Paper, Horizon.Intraday, before],
  );
  return result.map(mapPositionRow);
}

/** Served by positions_open_auto_idx. */
export async function getAllOpenAutoPositions() {
  const result = await rows(`SELECT * FROM positions WHERE source = ${sqlEnum(TradeSource.Auto)} AND NOT exited AND mode = ${sqlEnum(TradingMode.Paper)}`);
  return result.map(mapPositionRow);
}

/** Served by positions_open_auto_idx. */
export async function getOpenAutoPositions(userId) {
  const result = await rows(
    `SELECT * FROM positions WHERE user_id = $1 AND source = ${sqlEnum(TradeSource.Auto)} AND NOT exited AND mode = ${sqlEnum(TradingMode.Paper)}`,
    [userId],
  );
  return result.map(mapPositionRow);
}

/** The filter comes from parsePositionsQuery (positionsQuery.js). */
export async function getPositions(userId, filter = {}) {
  const todayStart = new Date(getTodayMidnight()).toISOString();
  const { sql, params } = buildPositionsQuery(userId, { ...filter, todayStart });
  const result = await rows(sql, params);
  return result.map(mapPositionRow);
}

/**
 * The filter comes from parseDailyPnlQuery (positionsQuery.js).
 * @returns {Promise<{ date: string, pnl: number, trades: number }[]>}
 */
export async function getDailyPnl(userId, filter) {
  const { sql, params } = buildDailyPnlQuery(userId, filter);
  const result = await rows(sql, params);
  return result.map((row) => ({ date: row.date, pnl: Number(row.pnl), charges: Number(row.charges), trades: Number(row.trades) }));
}

export async function getPositionStats(userId, { mode = null } = {}) {
  const todayStart = new Date(getTodayMidnight()).toISOString();
  const queries = buildStatsQueries(userId, { mode, todayStart });
  const [summary, best, worst] = await Promise.all([
    firstRow(queries.summary.sql, queries.summary.params),
    firstRow(queries.best.sql, queries.best.params),
    firstRow(queries.worst.sql, queries.worst.params),
  ]);
  return {
    closedTrades: Number(summary.closed_trades),
    winningTrades: Number(summary.winning_trades),
    losingTrades: Number(summary.losing_trades),
    avgWin: summary.avg_win === null ? 0 : Number(summary.avg_win),
    avgLoss: summary.avg_loss === null ? 0 : Number(summary.avg_loss),
    todayTrades: Number(summary.today_trades),
    bestTrade: best ? mapPositionRow(best) : null,
    worstTrade: worst ? mapPositionRow(worst) : null,
  };
}

function mapPositionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: Number(row.instrument_token),
    instrumentType: row.instrument_type,
    exchange: row.exchange,
    source: row.source,
    horizon: row.horizon,
    strike: row.strike,
    optionType: row.option_type,
    side: row.side,
    quantity: Number(row.quantity),
    entryPrice: row.entry_price,
    entryTime: row.entry_time,
    expiry: row.expiry,
    exited: row.exited === true,
    exitPrice: row.exit_price,
    exitTime: row.exit_time,
    note: row.note || '',
    targetPrice: row.target_price,
    stopLossPrice: row.stop_loss_price,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    // Set when it closes (shared/paperCharges.js); null while open or if closed before charges were recorded.
    charges: row.charges == null ? null : Number(row.charges),
    chargeBreakdown: row.charge_breakdown ?? null,
  };
}

/**
 * Closes a position with its charges (a shared/paperCharges.js breakdown). Only a position still open closes;
 * null if it was closed meanwhile.
 * @param {string} id
 * @param {{ exitPrice: number, exitTime: string, charges: { total: number } }} exit
 */
export async function closeOpenPosition(id, { exitPrice, exitTime, charges }) {
  const row = await firstRow(
    `UPDATE positions SET exited = true, exit_price = $1, exit_time = $2, charges = $3, charge_breakdown = $4
     WHERE id = $5 AND NOT exited
     RETURNING *`,
    [exitPrice, exitTime, charges.total, JSON.stringify(charges), id],
  );
  return row ? mapPositionRow(row) : null;
}

export function positionMetaValues(position) {
  return [
    position.note?.trim() || null,
    position.targetPrice === undefined || position.targetPrice === null || position.targetPrice === '' ? null : Number(position.targetPrice),
    position.stopLossPrice === undefined || position.stopLossPrice === null || position.stopLossPrice === '' ? null : Number(position.stopLossPrice),
    position.confidence === undefined || position.confidence === null || position.confidence === '' ? null : Number(position.confidence),
  ];
}

/**
 * Strike, option type and expiry as stored for each instrument type: options
 * keep all three, futures only the expiry, stocks none.
 */
export function instrumentColumns(position) {
  const type = position.instrumentType;
  const isOption = isOptionType(type);
  return {
    strike: isOption ? position.strike : null,
    optionType: isOption ? type : null,
    expiry: isOption || type === InstrumentType.FUT ? position.expiry : null,
  };
}

/**
 * A new open position of `quantity` (the trade's own, or what is left after netting) entered at `entryTime`.
 * @param {string} userId
 * @param {any} position  the trade, with its mode and source
 * @param {number} quantity
 * @param {string} entryTime  ISO timestamp
 */
export async function insertPosition(userId, position, quantity, entryTime) {
  const { strike, optionType, expiry } = instrumentColumns(position);
  const row = await firstRow(
    `INSERT INTO positions (id, user_id, mode, source, tradingsymbol, instrument_token, instrument_type, exchange, strike, option_type,
       side, quantity, entry_price, entry_time, expiry, note, target_price, stop_loss_price, confidence, horizon)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [crypto.randomUUID(), userId, position.mode, position.source, position.tradingsymbol, position.instrumentToken,
     position.instrumentType, position.exchange, strike, optionType, position.side, quantity, position.entryPrice, entryTime, expiry,
     ...positionMetaValues(position), position.horizon],
  );
  return mapPositionRow(row);
}

/**
 * The user's open position a trade could merge with: same instrument, side, source, mode and horizon.
 * @param {string} userId
 * @param {{ mode: string, instrumentToken: number, side: string, source: string, horizon: string }} match
 */
export async function findOpenPosition(userId, { mode, instrumentToken, side, source, horizon }) {
  const row = await firstRow(
    `SELECT * FROM positions
     WHERE user_id = $1 AND mode = $2 AND instrument_token = $3 AND side = $4 AND NOT exited AND source = $5 AND horizon = $6`,
    [userId, mode, instrumentToken, side, source, horizon],
  );
  return row ? mapPositionRow(row) : null;
}

/**
 * Sets an open position's merged quantity and average price; the trade's note, target, stop-loss and confidence
 * replace the position's where the trade gives them.
 * @param {string} id
 * @param {{ quantity: number, entryPrice: number }} merged
 * @param {any} trade
 */
export async function averageIntoPosition(id, { quantity, entryPrice }, trade) {
  const row = await firstRow(
    `UPDATE positions SET
       quantity = $1, entry_price = $2, note = COALESCE($3, note), target_price = COALESCE($4, target_price),
       stop_loss_price = COALESCE($5, stop_loss_price), confidence = COALESCE($6, confidence)
     WHERE id = $7
     RETURNING *`,
    [quantity, entryPrice, ...positionMetaValues(trade), id],
  );
  return mapPositionRow(row);
}

export async function setPositionQuantity(id, quantity) {
  return mapPositionRow(await firstRow('UPDATE positions SET quantity = $1 WHERE id = $2 RETURNING *', [quantity, id]));
}

export async function getOpenPosition(id, userId) {
  const row = await firstRow('SELECT * FROM positions WHERE id = $1 AND user_id = $2 AND NOT exited', [id, userId]);
  return row ? mapPositionRow(row) : null;
}
