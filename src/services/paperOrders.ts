/**
 * Paper limit orders: placing, listing and cancelling them (/api/paper-orders).
 *
 * A limit order fills like Zerodha's: a buy at its limit or lower, a sell at
 * its limit or higher. One that can fill when placed fills at once at the
 * last price; otherwise the server's order book fills it at its limit when a
 * live tick reaches it, and cancels it at the market close. The rules are in
 * shared/paperOrders.js; market orders still go through addPosition.
 */
import { apiClient } from './apiClient';
import type { NewPosition, Position } from './positions';

export type PaperOrderStatus = 'open' | 'filled' | 'cancelled';

export interface PaperOrder extends Pick<Position, 'tradingsymbol' | 'instrumentToken' | 'instrumentType' | 'exchange' | 'strike' | 'optionType' | 'expiry' | 'side' | 'quantity' | 'source'> {
  id: string;
  /** The automated trade it enters, for an order the trade automation placed (source auto). */
  autoTradeId: string | null;
  limitPrice: number;
  status: PaperOrderStatus;
  /** Why it was cancelled: by the user, at the market close, or a refused fill. */
  statusReason: string | null;
  /** The price it filled at: the last price when it filled on placing, else its limit. */
  fillPrice: number | null;
  positionId: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

/** A limit order to place: a paper trade with its limit price in place of an entry price. */
export type NewLimitOrder = Omit<NewPosition, 'entryPrice' | 'mode'> & { limitPrice: number };

/** Place a limit order; the reply says whether it filled at once or is open. */
export function placeLimitOrder(order: NewLimitOrder): Promise<PaperOrder> {
  return apiClient.post('/api/paper-orders', order);
}

/** Orders placed from `from` to `to` (YYYY-MM-DD, IST days, inclusive), newest first. */
export function fetchPaperOrders(range: { from: string; to: string }, signal?: AbortSignal): Promise<PaperOrder[]> {
  const params = new URLSearchParams(range);
  return apiClient.get(`/api/paper-orders?${params}`, { signal });
}

/**
 * What to tell the user about an order just placed: filled at once, waiting
 * for its price, or cancelled because paper trading refused the fill.
 * `label` names the trade, e.g. "BUY 24000CE".
 */
export function placedOrderMessage(order: PaperOrder, label: string): string {
  if (order.status === 'filled') return `${label} filled @ ${(order.fillPrice ?? order.limitPrice).toFixed(2)}`;
  if (order.status === 'cancelled') return `${label} not filled · ${order.statusReason ?? 'cancelled'}`;
  return `${label} limit @ ${order.limitPrice.toFixed(2)} placed · fills when the price reaches it`;
}

/** Cancel an open order. */
export function cancelPaperOrder(id: string): Promise<PaperOrder> {
  return apiClient.patch(`/api/paper-orders/${id}`, { status: 'cancelled' });
}
