/**
 * Positions: what a filled order does to the user's positions. Only the order
 * service (services/orders.js) calls these, after it has decided the fill
 * price, so every trade, manual or automated, entry or exit, goes through one
 * path and is checked against the same rules (shared/paperTradeRules.js).
 *
 * - openPosition opens a position at the fill, or adds to an open one on the
 *   same instrument from the same source and horizon, at the average price.
 * - closePosition closes an open position at the fill and records its charges
 *   (shared/paperCharges.js, via db.js), dated when it happens. Closing an
 *   automated position (source 'auto') also closes the automated trades behind
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
import { addPosition, closeAutoTradesOfPosition, exitPositionById, getOpenPosition } from '../db.js';
import { checkPaperTrade, normalizeTradeInput } from '../../shared/paperTradeRules.js';
import { algoLog } from '../algoLog.js';
import { paperPnl } from '../../shared/paperPnl.js';
import { SESSION_SQUARE_OFF_ID } from '../../shared/exitRules/index.js';

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
 * @param {{ now?: Date, source?: 'manual' | 'auto' }} [options] now: when the trade happens.
 *   source: who placed it, set by the caller and never taken from the request; a trade merges
 *   only with open positions from the same source.
 */
export async function openPosition(userId, input, { now = new Date(), source = 'manual' } = {}) {
  const trade = normalizeTradeInput(input);
  const result = checkPaperTrade('open', { trade, now });
  if (!result.ok) return refused(result.violations[0]);
  return { ok: true, position: await addPosition(userId, { ...trade, source }) };
}

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
  const result = checkPaperTrade('exit', { position, exitPrice, now });
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
  const result = checkPaperTrade('square-off', { position, exitPrice, now: at });
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
  // Another request may have closed it since it was checked.
  const exited = await exitPositionById(position.id, userId, fill, now);
  if (!exited) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };
  if (position.source === 'auto') {
    await closeAutoTradesOfPosition(userId, position, fill, exitReason, now);
    algoLog('Exit', 'booked', bookedDetails(userId, position, exited, fill, exitReason));
  }
  return { ok: true, position: exited };
}
