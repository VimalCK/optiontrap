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
 * Both functions return a result instead of throwing for a refused trade:
 *   { ok: true, position }                  done
 *   { ok: false, code, message, rule? }     refused; code is one of
 *     INVALID_TRADE  the request is incomplete or malformed
 *     MARKET_CLOSED  a rule says not now
 *     NOT_FOUND      no such open position (exit only)
 */
import { addPosition, closeAutoTradesOfPosition, exitPositionById, getOpenPosition } from './db.js';
import { checkPaperTrade, normalizeTradeInput } from '../shared/paperTradeRules.js';

export const NOT_FOUND = 'NOT_FOUND';
const NOT_FOUND_MESSAGE = 'Position not found or already exited';
/** Why an automated position was exited when no exit rule says so: the user did it. */
export const MANUAL_EXIT = { ruleId: null, reason: 'Exited manually' };

const refused = ({ rule, code, message }) => ({ ok: false, code, message, rule });

/**
 * Open (or net against) a paper position for `userId`.
 * @param {string} userId
 * @param {Record<string, unknown>} input tradingsymbol, instrumentToken, instrumentType (CE, PE, FUT
 *   or EQ), side, quantity, entryPrice; strike and expiry for options, expiry for futures; and
 *   optionally exchange, mode, note, targetPrice, stopLossPrice, strategyTag, confidence
 * @param {{ now?: Date, source?: 'manual' | 'auto' }} [options] now: when the trade happens (defaults
 *   to the current time). source: who placed it, set by the caller and never taken from the request;
 *   a trade merges only with open positions from the same source.
 */
export async function openPaperTrade(userId, input, { now = new Date(), source = 'manual' } = {}) {
  const trade = normalizeTradeInput(input);
  const result = checkPaperTrade('open', { trade, now });
  if (!result.ok) return refused(result.violations[0]);

  const position = await addPosition(userId, { ...trade, source });
  return { ok: true, position };
}

/**
 * Exit one of `userId`'s open positions at `exitPrice`; for an automated
 * position, close the automated trades behind it too.
 * @param {string} userId
 * @param {string} positionId
 * @param {number | string | null | undefined} exitPrice
 * @param {{ now?: Date, exitReason?: { ruleId: string | null, reason: string } }} [options]
 *   exitReason: why, recorded on the automated trades (an exit rule's, or MANUAL_EXIT by default)
 */
export async function exitPaperTrade(userId, positionId, exitPrice, { now = new Date(), exitReason = MANUAL_EXIT } = {}) {
  const position = await getOpenPosition(positionId, userId);
  if (!position) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };

  const result = checkPaperTrade('exit', { position, exitPrice, now });
  if (!result.ok) return refused(result.violations[0]);

  // Another request may have exited it since the lookup.
  const exited = await exitPositionById(positionId, userId, Number(exitPrice));
  if (!exited) return { ok: false, code: NOT_FOUND, message: NOT_FOUND_MESSAGE };
  if (position.source === 'auto') await closeAutoTradesOfPosition(userId, positionId, Number(exitPrice), exitReason);
  return { ok: true, position: { ...position, exited: true, exitPrice: Number(exitPrice) } };
}
