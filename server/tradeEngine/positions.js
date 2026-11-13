/**
 * Positions: what a filled order does to the user's positions. Only the order
 * service (services/orders.js) calls these, after it has decided the fill
 * price, so every trade, manual or automated, entry or exit, goes through one
 * path and is checked against the same rules (shared/paperTradeRules.js).
 *
 * - openPosition opens a position at the fill, or merges it with an open one
 *   (bookTrade): the merge rules and the charges are decided here, and db.js
 *   only stores the result.
 * - closePosition closes an open position at the fill and records its charges
 *   (shared/paperCharges.js), dated when it happens. Closing an
 *   automated position (source Auto) also closes the automated trades behind
 *   it, with why: the exit rule's reason from the trade monitor, "Exited
 *   manually" (MANUAL_EXIT), or the engine's square-off after the close
 *   (SESSION_SQUARE_OFF). It is checked first by closablePosition (an exit) or
 *   squareOffable (a square-off).
 *
 * Both return a result instead of throwing for a refused trade:
 *   { ok: true, position }                  done
 *   { ok: false, code, message, rule? }     refused; code is one of
 *     INVALID_TRADE  the request is incomplete or malformed
 *     MARKET_CLOSED  a rule says not now
 *     NOT_FOUND      no such open position (close only)
 */
import {
  averageIntoPosition,
  closeAutoTrades,
  closeOpenPosition,
  findOpenPosition,
  getExecutedAutoTrades,
  getOpenPosition,
  insertPosition,
  setPositionQuantity,
} from '../db.js';
import { checkPaperTrade, normalizeTradeInput } from '../../shared/paperTradeRules.js';
import { roundTripCharges } from '../../shared/paperCharges.js';
import { algoLog } from '../algoLog.js';
import { paperPnl } from '../../shared/paperPnl.js';
import { SESSION_SQUARE_OFF_ID } from '../../shared/exitRules/index.js';
import { PaperTradeAction, TradeSource, TradingMode, oppositeSide } from '../../shared/tradeEnums.js';

export const NOT_FOUND = 'NOT_FOUND';
const NOT_FOUND_MESSAGE = 'Position not found or already exited';
/** Why an automated position was exited when no exit rule says so: the user did it. */
export const MANUAL_EXIT = { ruleId: null, reason: 'Exited manually' };
/** Why the engine closed an intraday position its session left open (services/sessionSquareOff.js). */
export const SESSION_SQUARE_OFF = { ruleId: SESSION_SQUARE_OFF_ID, reason: 'Squared off after the market close' };

const refused = ({ rule, code, message }) => ({ ok: false, code, message, rule });

/**
 * Open (or add to) a position for `userId` at the trade's entryPrice (the fill).
 * @param {string} userId
 * @param {Record<string, unknown>} input tradingsymbol, instrumentToken, instrumentType (CE, PE, FUT
 *   or EQ), side, quantity, entryPrice, horizon; strike and expiry for options, expiry for futures; and
 *   optionally exchange, mode, note, targetPrice, stopLossPrice, confidence
 * @param {{ now?: Date, source?: import('../../shared/tradeEnums.js').TradeSourceId }} [options] now: when the trade happens.
 *   source: who placed it, set by the caller and never taken from the request; a trade merges
 *   only with open positions from the same source.
 */
export async function openPosition(userId, input, { now = new Date(), source = TradeSource.Manual } = {}) {
  const trade = normalizeTradeInput(input);
  const result = checkPaperTrade(PaperTradeAction.Open, { trade, now });
  if (!result.ok) return refused(result.violations[0]);
  return { ok: true, position: await bookTrade(userId, { ...trade, mode: trade.mode || TradingMode.Paper, source }) };
}

/**
 * A position's charges for closing at `exitPrice` at `exitTime` (shared/paperCharges.js).
 * @param {{ instrumentType: string, side: any, quantity: number, entryPrice: number, entryTime: string }} position
 * @param {number} exitPrice
 * @param {Date} exitTime
 */
export const positionCharges = (position, exitPrice, exitTime) => roundTripCharges({
  instrumentType: position.instrumentType,
  side: position.side,
  quantity: Number(position.quantity),
  entryPrice: Number(position.entryPrice),
  entryTime: new Date(position.entryTime),
}, exitPrice, exitTime);

/**
 * An automated trade's own charges: its entry and exit at its own prices, since merged trades share one
 * position at the average price. A trade with no entry price recorded counts as entered at the exit price.
 * @param {{ side: any, quantity: number, entryPrice: number | null, createdAt: any }} trade
 * @param {string} instrumentType
 * @param {number} exitPrice
 * @param {Date} exitTime
 */
export const autoTradeCharges = (trade, instrumentType, exitPrice, exitTime) => roundTripCharges({
  instrumentType,
  side: trade.side,
  quantity: Number(trade.quantity),
  entryPrice: Number(trade.entryPrice ?? exitPrice),
  entryTime: trade.createdAt,
}, exitPrice, exitTime).total;

/**
 * An open position with a trade on the same side added: the summed quantity at the average price, to 2 decimals.
 * @param {{ quantity: number, entryPrice: number }} position
 * @param {{ quantity: number, entryPrice: number }} trade
 */
export function averagedIn(position, trade) {
  const quantity = Number(position.quantity) + trade.quantity;
  const average = (position.entryPrice * Number(position.quantity) + trade.entryPrice * trade.quantity) / quantity;
  return { quantity, entryPrice: Number(average.toFixed(2)) };
}

/**
 * Books a trade. It merges with the user's open position in the same instrument from the same source and of the
 * same horizon (intraday or positional): the same side averages in, the opposite side nets out (closing it, at the
 * trade's price, when the trade covers it, and opening the rest the other way). Manual trades merge with manual
 * positions and automated trades (source Auto) with automated ones, so 100 bought by the automation then 500 more
 * shows as one automated position of 600, and the automation never changes a manual position (or the other way round).
 * @param {string} userId
 * @param {any} trade  normalized, with its mode and source
 */
async function bookTrade(userId, trade) {
  const now = new Date();
  const match = { mode: trade.mode, instrumentToken: trade.instrumentToken, source: trade.source, horizon: trade.horizon };

  const sameSide = await findOpenPosition(userId, { ...match, side: trade.side });
  if (sameSide) return averageIntoPosition(sameSide.id, averagedIn(sameSide, trade), trade);

  const opposite = await findOpenPosition(userId, { ...match, side: oppositeSide(trade.side) });
  if (!opposite) return insertPosition(userId, trade, trade.quantity, now.toISOString());
  if (trade.quantity < opposite.quantity) return setPositionQuantity(opposite.id, opposite.quantity - trade.quantity);

  const closed = await closeAt(opposite, trade.entryPrice, now);
  if (trade.quantity === opposite.quantity) return closed ?? opposite;
  return insertPosition(userId, trade, trade.quantity - opposite.quantity, now.toISOString());
}

/** Null if the position was closed meanwhile. */
const closeAt = (position, exitPrice, at) => closeOpenPosition(position.id, {
  exitPrice,
  exitTime: at.toISOString(),
  charges: positionCharges(position, exitPrice, at),
});

/**
 * The algo log details of a booked automated position: entry, exit, P&L
 * before and after charges, and why it was exited.
 * @param {string} userId
 * @param {{ side: string, quantity: number, entryPrice: number, tradingsymbol: string }} position  as it was open
 * @param {{ charges: number | null }} exited
 * @param {number} fill  the exit price
 * @param {{ reason: string }} exitReason
 */
export function bookedDetails(userId, position, exited, fill, exitReason) {
  const pnl = paperPnl({ side: position.side, quantity: Number(position.quantity), entryPrice: Number(position.entryPrice) }, fill);
  const charges = exited.charges ?? 0;
  return {
    trade: `${position.side} ${position.quantity} ${position.tradingsymbol}`,
    entry: position.entryPrice,
    exit: fill,
    'P&L': `₹${pnl.toFixed(2)}`,
    charges: `₹${charges.toFixed(2)}`,
    net: `₹${(pnl - charges).toFixed(2)}`,
    user: userId,
    reason: exitReason.reason,
  };
}

/**
 * One of the user's open positions, checked for closing at `exitPrice` now:
 * the position, or why it can't be closed.
 * @param {string} userId
 * @param {string} positionId
 * @param {unknown} exitPrice
 * @param {Date} now
 */
export async function closablePosition(userId, positionId, exitPrice, now) {
  const position = await getOpenPosition(positionId, userId);
  if (!position) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };
  const result = checkPaperTrade(PaperTradeAction.Exit, { position, exitPrice, now });
  if (!result.ok) return refused(result.violations[0]);
  return { ok: true, position };
}

/**
 * An open position, checked for the engine's square-off at `exitPrice` (its
 * last price after the close) at `at`: ok, or why it can't be.
 * @param {any} position  the open position
 * @param {unknown} exitPrice
 * @param {Date} at
 */
export function squareOffable(position, exitPrice, at) {
  const result = checkPaperTrade(PaperTradeAction.SquareOff, { position, exitPrice, now: at });
  return result.ok ? { ok: true, position } : refused(result.violations[0]);
}

/**
 * Close one of `userId`'s open positions at `fill` at `now` (already checked by
 * closablePosition or squareOffable); for an automated position, close the
 * automated trades behind it too.
 * @param {string} userId
 * @param {any} position  the open position, from closablePosition
 * @param {number} fill
 * @param {{ now?: Date, exitReason?: { ruleId: string | null, reason: string } }} [options]
 *   now: the exit time. exitReason: why, recorded on the automated trades (an exit rule's, or MANUAL_EXIT by default).
 */
export async function closePosition(userId, position, fill, { now = new Date(), exitReason = MANUAL_EXIT } = {}) {
  // Read again: another request may have closed or added to it since it was checked.
  const open = await getOpenPosition(position.id, userId);
  const exited = open && await closeAt(open, fill, now);
  if (!exited) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };
  if (position.source === TradeSource.Auto) {
    await closeAutoTradesOf(userId, position, fill, exitReason, now);
    algoLog('Exit', 'booked', bookedDetails(userId, position, exited, fill, exitReason));
  }
  return { ok: true, position: exited };
}

async function closeAutoTradesOf(userId, position, fill, exitReason, now) {
  const trades = await getExecutedAutoTrades(userId, position.id);
  const withCharges = trades.map((trade) => ({ id: trade.id, charges: autoTradeCharges(trade, position.instrumentType, fill, now) }));
  return closeAutoTrades(userId, position.id, withCharges, fill, exitReason);
}
