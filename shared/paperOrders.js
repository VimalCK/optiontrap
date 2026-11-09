/**
 * Paper limit orders: the rules that decide when one fills, shared by the
 * server's order book (server/paperOrderBook.js) and the browser.
 *
 * They work like Zerodha's limit orders: a buy fills at the limit or lower, a
 * sell at the limit or higher. An order that can fill when it is placed fills
 * at once at the last traded price (the better price); otherwise it waits and
 * fills at its limit when a live tick reaches it. Open orders are cancelled
 * at the market close. Market orders don't go through here: they fill at
 * once through POST /api/positions.
 *
 * An order opens its position through the one paper-trading path
 * (server/paperTrading.js), so the paper trade rules (shared/paperTradeRules.js)
 * apply when it is placed and again when it fills.
 */
import { checkPaperTrade, normalizeTradeInput, RULE_CODES } from './paperTradeRules.js';

/** @typedef {'open' | 'filled' | 'cancelled'} PaperOrderStatus */
export const PAPER_ORDER_STATUSES = /** @type {const} */ (['open', 'filled', 'cancelled']);

/** Why an order was cancelled, when it wasn't the user's own cancel. */
export const CANCELLED_AT_CLOSE = 'Cancelled at market close';
export const CANCELLED_BY_USER = 'Cancelled';

/**
 * Whether a limit order fills at this price: a buy at its limit or lower, a
 * sell at its limit or higher.
 * @param {'BUY' | 'SELL'} side
 * @param {number} limitPrice
 * @param {number} lastPrice
 */
export const canFill = (side, limitPrice, lastPrice) => (side === 'BUY' ? lastPrice <= limitPrice : lastPrice >= limitPrice);

/**
 * @typedef {ReturnType<typeof normalizeTradeInput> & { limitPrice: number }} LimitOrder
 *   the trade the order opens (its entryPrice is the limit), with the limit price
 */

/**
 * Parse a limit order from a request body: the fields of a paper trade, with
 * `limitPrice` in place of `entryPrice`, checked by the paper trade rules as
 * a trade at the limit price would be (so it can't be placed while the market
 * is closed).
 * @param {Record<string, unknown>} input
 * @param {{ now?: Date }} [options]
 * @returns {{ order: LimitOrder, error?: undefined } | { error: string, code: string, order?: undefined }}
 */
export function parseLimitOrder(input, { now = new Date() } = {}) {
  const limitPrice = Number(input.limitPrice);
  if (!(limitPrice > 0)) return { error: 'Limit price must be more than 0', code: RULE_CODES.INVALID_TRADE };
  const trade = normalizeTradeInput({ ...input, entryPrice: limitPrice });
  const result = checkPaperTrade('open', { trade, now });
  if (!result.ok) return { error: result.violations[0].message, code: result.violations[0].code };
  return { order: { ...trade, limitPrice } };
}
