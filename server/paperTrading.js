/**
 * Paper trading: the one code path that opens and exits paper trades.
 *
 * The /api/positions routes call these, and the trade automation must call
 * the same functions, never the database directly, so every paper trade is
 * checked against the same rules (shared/paperTradeRules.js) and recorded
 * the same way.
 *
 * Exiting an automated position (source 'auto') also closes the automated
 * trades behind it at the exit price, with why it was exited: the exit rule's
 * reason from the trade monitor, or "Exited manually" from the Exit button.
 *
 * Market orders fill like Zerodha's when the caller passes a Kite session
 * (`fillFrom`): a buy at the best ask, a sell at the best bid, from a quote
 * taken now (server/paperFills.js); the price sent is kept only when the quote
 * has none. Limit orders pass no session and fill at their limit. Charges are
 * recorded when a position closes (shared/paperCharges.js, via db.js).
 *
 * Both functions return a result instead of throwing for a refused trade:
 *   { ok: true, position }                  done
 *   { ok: false, code, message, rule? }     refused; code is one of
 *     INVALID_TRADE  the request is incomplete or malformed
 *     MARKET_CLOSED  a rule says not now
 *     NOT_FOUND      no such open position (exit only)
 */
import { addPosition, closeAutoTradesOfPosition, exitPositionById, getOpenPosition } from './db.js';
import { checkPaperTrade, normalizeTradeInput } from '../shared/paperTradeRules.js';
import { quotedFillPrice } from './paperFills.js';
import { algoLog } from './algoLog.js';
import { paperPnl } from '../shared/paperPnl.js';

export const NOT_FOUND = 'NOT_FOUND';
const NOT_FOUND_MESSAGE = 'Position not found or already exited';
/** Why an automated position was exited when no exit rule says so: the user did it. */
export const MANUAL_EXIT = { ruleId: null, reason: 'Exited manually' };

const refused = ({ rule, code, message }) => ({ ok: false, code, message, rule });

/**
 * The market fill for an order: the bid or ask from a quote with `kite`, or
 * `price` when there is no session (a limit fill) or the quote has none.
 * @param {{ apiKey: string, accessToken: string } | undefined} kite
 * @param {{ exchange: string, tradingsymbol: string }} instrument
 * @param {'BUY' | 'SELL'} side
 * @param {number} price
 * @param {typeof quotedFillPrice} fillPrice
 */
async function marketFill(kite, instrument, side, price, fillPrice) {
  if (!kite) return price;
  try {
    return (await fillPrice(kite, instrument, side)) ?? price;
  } catch (err) {
    console.warn(`[PaperTrading] no quote for ${instrument.tradingsymbol}, filling at ${price}: ${/** @type {Error} */ (err).message}`);
    return price;
  }
}

/**
 * Open (or net against) a paper position for `userId`.
 * @param {string} userId
 * @param {Record<string, unknown>} input tradingsymbol, instrumentToken, instrumentType (CE, PE, FUT
 *   or EQ), side, quantity, entryPrice; strike and expiry for options, expiry for futures; and
 *   optionally exchange, mode, note, targetPrice, stopLossPrice, strategyTag, confidence
 * @param {{ now?: Date, source?: 'manual' | 'auto', fillFrom?: { apiKey: string, accessToken: string },
 *   fillPrice?: typeof quotedFillPrice }} [options] now: when the trade happens (defaults to the current
 *   time). source: who placed it, set by the caller and never taken from the request; a trade merges
 *   only with open positions from the same source. fillFrom: a Kite session to fill a market order at
 *   the bid / ask (left out for a limit fill at entryPrice). fillPrice: injectable, for tests.
 */
export async function openPaperTrade(userId, input, { now = new Date(), source = 'manual', fillFrom, fillPrice = quotedFillPrice } = {}) {
  const trade = normalizeTradeInput(input);
  const result = checkPaperTrade('open', { trade, now });
  if (!result.ok) return refused(result.violations[0]);

  const entryPrice = await marketFill(fillFrom, trade, trade.side, trade.entryPrice, fillPrice);
  const position = await addPosition(userId, { ...trade, entryPrice, source });
  return { ok: true, position };
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
 * Exit one of `userId`'s open positions at `exitPrice`; for an automated
 * position, close the automated trades behind it too.
 * @param {string} userId
 * @param {string} positionId
 * @param {number | string | null | undefined} exitPrice
 * @param {{ now?: Date, exitReason?: { ruleId: string | null, reason: string },
 *   fillFrom?: { apiKey: string, accessToken: string }, fillPrice?: typeof quotedFillPrice }} [options]
 *   exitReason: why, recorded on the automated trades (an exit rule's, or MANUAL_EXIT by default).
 *   fillFrom: a Kite session to exit at the bid / ask, as a market order (else at exitPrice).
 */
export async function exitPaperTrade(userId, positionId, exitPrice, { now = new Date(), exitReason = MANUAL_EXIT, fillFrom, fillPrice = quotedFillPrice } = {}) {
  const position = await getOpenPosition(positionId, userId);
  if (!position) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };

  const result = checkPaperTrade('exit', { position, exitPrice, now });
  if (!result.ok) return refused(result.violations[0]);

  const exitSide = position.side === 'BUY' ? 'SELL' : 'BUY';
  const fill = await marketFill(fillFrom, position, exitSide, Number(exitPrice), fillPrice);
  // Another request may have exited it since the lookup.
  const exited = await exitPositionById(positionId, userId, fill);
  if (!exited) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };
  if (position.source === 'auto') {
    await closeAutoTradesOfPosition(userId, position, fill, exitReason, now);
    algoLog('Exit', 'booked', bookedDetails(userId, position, exited, fill, exitReason));
  }
  return { ok: true, position: exited };
}
