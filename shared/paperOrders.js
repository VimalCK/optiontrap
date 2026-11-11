/**
 * Paper orders: what an order is and when one fills, shared by the server's
 * order service (server/tradeEngine/services/orders.js) and the browser.
 *
 * Two kinds, like Zerodha's:
 *   limit   a buy fills at the limit or lower, a sell at the limit or higher.
 *           One that can fill when it is placed (in market hours) fills at
 *           once at the last traded price (the better price); otherwise it
 *           waits and fills at its limit when a live tick reaches it.
 *   market  fills at the bid / ask: at once when placed in market hours,
 *           otherwise on the first live tick after the open (a positional
 *           one may be placed while the market is closed).
 *
 * Intraday orders are placed only in market hours; positional ones at any
 * time (the intraday-market-hours paper trade rule). Orders placed during a
 * session are cancelled at its close; ones placed after it wait for the next.
 *
 * An order opens its position through the one paper-trading path
 * (server/tradeEngine/positions.js), so the paper trade rules (shared/paperTradeRules.js)
 * apply when it is placed ('place') and again when it fills ('open').
 */
import { checkPaperTrade, normalizeTradeInput, RULE_CODES } from './paperTradeRules.js';

/** @typedef {'open' | 'filled' | 'cancelled'} PaperOrderStatus */
export const PAPER_ORDER_STATUSES = /** @type {const} */ (['open', 'filled', 'cancelled']);

/** @typedef {'limit' | 'market'} OrderType */
export const ORDER_TYPES = /** @type {const} */ (['limit', 'market']);

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
 * @typedef {ReturnType<typeof normalizeTradeInput> & { orderType: OrderType, limitPrice: number | null }} Order
 *   the trade the order opens, with its type and its limit (null for a market
 *   order). Its entryPrice is the limit, or for a market order the last price
 *   when it was placed (the fill happens at the bid / ask).
 */

/**
 * Parse an order from a request body: the fields of a paper trade, with
 * `orderType` ('limit' or 'market') and, for a limit order, `limitPrice` in
 * place of `entryPrice`. Checked by the paper trade rules for placing an
 * order: an intraday one only in market hours, a positional one at any time.
 * @param {Record<string, unknown>} input
 * @param {{ now?: Date, lastPrice?: number }} [options] lastPrice: the instrument's last
 *   traded price, a market order's reference price
 * @returns {{ order: Order, error?: undefined } | { error: string, code: string, order?: undefined }}
 */
export function parseOrder(input, { now = new Date(), lastPrice } = {}) {
  const orderType = /** @type {OrderType} */ (input.orderType);
  if (!ORDER_TYPES.includes(orderType)) return { error: `orderType must be one of: ${ORDER_TYPES.join(', ')}`, code: RULE_CODES.INVALID_TRADE };
  const limitPrice = orderType === 'limit' ? Number(input.limitPrice) : null;
  if (limitPrice !== null && !(limitPrice > 0)) return { error: 'Limit price must be more than 0', code: RULE_CODES.INVALID_TRADE };
  const trade = normalizeTradeInput({ ...input, entryPrice: limitPrice ?? lastPrice });
  const result = checkPaperTrade('place', { trade, now });
  if (!result.ok) return { error: result.violations[0].message, code: result.violations[0].code };
  return { order: { ...trade, orderType, limitPrice } };
}
