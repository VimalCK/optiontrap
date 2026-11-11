/**
 * Paper orders (/api/orders): placing, listing and cancelling them, placing a
 * trade at the market (placeMarketTrade) and exiting a position
 * (exitPosition). Every paper trade, entry or exit, is an order filled by the
 * server's trade engine (server/tradeEngine/services/orders.js).
 *
 * A limit order fills like Zerodha's: a buy at its limit or lower, a sell at
 * its limit or higher. One that can fill when placed fills at once at the
 * last price; otherwise the engine fills it at its limit when a live tick
 * reaches it. A market order fills at the bid / ask: at once in market hours,
 * else on the first tick after the open. Orders fill only in market hours;
 * intraday ones are placed only then, positional ones at any time. Orders
 * placed in a session are cancelled at its close. The rules are in
 * shared/paperOrders.js.
 */
import { apiClient } from './apiClient';
import type { NewPosition, Position } from './positions';

export type PaperOrderStatus = 'open' | 'filled' | 'cancelled';
export type OrderType = 'limit' | 'market';

export interface PaperOrder extends Pick<Position, 'tradingsymbol' | 'instrumentToken' | 'instrumentType' | 'exchange' | 'strike' | 'optionType' | 'expiry' | 'side' | 'quantity' | 'source' | 'horizon'> {
  id: string;
  /** The automated trade it enters, for an order the trade automation placed (source auto). */
  autoTradeId: string | null;
  orderType: OrderType;
  /** null for a market order. */
  limitPrice: number | null;
  status: PaperOrderStatus;
  /** Why it was cancelled: by the user, at the market close, or a refused fill. */
  statusReason: string | null;
  /** The price it filled at: the last price or its limit for a limit order, the bid / ask for a market one. */
  fillPrice: number | null;
  positionId: string | null;
  /** Whether it exits a position (a closing order) rather than opening or adding to one. */
  closesPosition: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

/** A trade to place as an order: no entry price, as the server prices it (from a quote, or the limit). */
export type OrderTrade = Omit<NewPosition, 'entryPrice' | 'mode'>;

/** An order to place: a paper trade with its type; a limit order has its limit price. */
export type NewOrder = OrderTrade & ({ orderType: 'limit'; limitPrice: number } | { orderType: 'market' });

/** Place an order; the reply says whether it filled at once or is open. */
export function placeOrder(order: NewOrder): Promise<PaperOrder> {
  return apiClient.post('/api/orders', order);
}

/**
 * Place a trade at the market: filled at once at the bid / ask in market
 * hours; a positional one placed while the market is closed fills at the open.
 */
export function placeMarketTrade(trade: OrderTrade): Promise<PaperOrder> {
  return placeOrder({ ...trade, orderType: 'market' });
}

/**
 * Exit an open position: a market order for its whole quantity, filled at
 * once at the bid / ask (`exitPrice`, the last price shown, when the quote has none).
 */
export function exitPosition(positionId: string, exitPrice: number): Promise<PaperOrder> {
  return apiClient.post('/api/orders', { positionId, exitPrice });
}

/** Every open order, whenever it was placed, newest first (the Pending tab). */
export function fetchOpenOrders(signal?: AbortSignal): Promise<PaperOrder[]> {
  return apiClient.get('/api/orders?status=open', { signal });
}

/** Cancel an open order. */
export function cancelOrder(id: string): Promise<PaperOrder> {
  return apiClient.patch(`/api/orders/${id}`, { status: 'cancelled' });
}

/** Whether paper trading refused an order just placed (it was cancelled), for a red toast. */
export const placedOrderRefused = (order: PaperOrder): boolean => order.status === 'cancelled';

/**
 * What to tell the user about an order just placed: filled at once, waiting
 * for its price or for the market to open, or cancelled because paper trading
 * refused the fill. `label` names the trade, e.g. "BUY 24000CE".
 */
export function placedOrderMessage(order: PaperOrder, label: string): string {
  if (order.status === 'filled') return `${label} filled @ ${(order.fillPrice ?? 0).toFixed(2)}`;
  if (order.status === 'cancelled') return `${label} not filled · ${order.statusReason ?? 'cancelled'}`;
  if (order.limitPrice === null) return `${label} market order placed · fills when the market opens`;
  return `${label} limit @ ${order.limitPrice.toFixed(2)} placed · fills when the price reaches it`;
}
