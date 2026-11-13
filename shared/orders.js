/**
 * Orders, shared by the order service (server/tradeEngine/services/orders.js)
 * and the browser. Fill rules follow Zerodha's:
 *   limit   a buy fills at the limit or lower, a sell at the limit or higher.
 *           If it can fill when placed it fills at once at the last price
 *           (the better price); otherwise on the first live tick that reaches it.
 *   market  fills at the bid / ask: at once in market hours, otherwise on the
 *           first live tick after the open.
 *
 * Intraday orders are placed only in market hours (positional ones any time).
 * Orders placed during a session are cancelled at its close.
 *
 * An order opens its position through server/tradeEngine/positions.js, so the
 * trade rules run again when it fills (TradeAction.Open).
 */
import { checkTrade, normalizeTradeInput, RULE_CODES } from './tradeRules.js';
import { ORDER_TYPES, OrderType, TradeAction, Side } from './tradeEnums.js';

/** Cancel reasons: the close cancels orders the user left open; CANCELLED_BY_USER is the user's own cancel. */
export const CANCELLED_AT_CLOSE = 'Cancelled at market close';
export const CANCELLED_BY_USER = 'Cancelled';

/**
 * @param {import('./tradeEnums.js').SideId} side
 * @param {number} limitPrice
 * @param {number} lastPrice
 */
export const canFill = (side, limitPrice, lastPrice) => (side === Side.BUY ? lastPrice <= limitPrice : lastPrice >= limitPrice);

/**
 * @typedef {ReturnType<typeof normalizeTradeInput> & { orderType: import('./tradeEnums.js').OrderTypeId, limitPrice: number | null }} Order
 *   the trade the order opens, with its type and its limit (null for a market
 *   order). Its entryPrice is the limit, or for a market order the last price
 *   when it was placed (the fill happens at the bid / ask).
 */

/**
 * A limit order takes `limitPrice` in place of `entryPrice`.
 * @param {Record<string, unknown>} input
 * @param {{ now?: Date, lastPrice?: number }} [options] lastPrice: the instrument's last
 *   traded price, a market order's reference price
 * @returns {{ order: Order, error?: undefined } | { error: string, code: string, order?: undefined }}
 */
export function parseOrder(input, { now = new Date(), lastPrice } = {}) {
  const orderType = /** @type {import('./tradeEnums.js').OrderTypeId} */ (input.orderType);
  if (!ORDER_TYPES.includes(orderType)) return { error: `orderType must be one of: ${ORDER_TYPES.join(', ')}`, code: RULE_CODES.INVALID_TRADE };
  const limitPrice = orderType === OrderType.Limit ? Number(input.limitPrice) : null;
  if (limitPrice !== null && !(limitPrice > 0)) return { error: 'Limit price must be more than 0', code: RULE_CODES.INVALID_TRADE };
  const trade = normalizeTradeInput({ ...input, entryPrice: limitPrice ?? lastPrice });
  const result = checkTrade(TradeAction.Place, { trade, now });
  if (!result.ok) return { error: result.violations[0].message, code: result.violations[0].code };
  return { order: { ...trade, orderType, limitPrice } };
}
