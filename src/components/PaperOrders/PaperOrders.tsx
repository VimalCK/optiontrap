/**
 * Orders fill on the server, so while any is open in market hours usePaperOrders
 * reloads the list every few seconds. The page runs the hook whichever tab is
 * showing, so fills reach the positions either way. Rules: shared/orders.js.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Badge from '@/components/Badge/Badge';
import { MessageTone, Tone, type ToneId } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import EmptyState from '@/components/EmptyState/EmptyState';
import { PaperTradingIcon } from '@/components/icons/Icons';
import PositionInstrument from '@/components/PositionInstrument/PositionInstrument';
import { cancelOrder, fetchOpenOrders, type PaperOrder } from '@/services/orders';
import { tradeErrorMessage } from '@/services/positions';
import { isAbortError } from '@/services/apiClient';
import { istTimeLabel, isMarketLive } from '@/utils/marketStatus';
import { OrderStatus } from '../../../shared/tradeEnums.js';
import '@/styles/positions.css';

const ORDER_REFRESH_MS = 5000;

export function orderStatus(order: PaperOrder): { tone: ToneId; text: string } {
  if (order.status === OrderStatus.Open) return { tone: Tone.Accent, text: 'Open' };
  if (order.status === OrderStatus.Filled) return { tone: Tone.Positive, text: `Filled @ ${(order.fillPrice ?? order.limitPrice ?? 0).toFixed(2)}` };
  return { tone: Tone.Neutral, text: order.statusReason ?? 'Cancelled' };
}

/**
 * Whether any order that was open before has left the open list (filled, or
 * cancelled after a refused fill), so the positions should reload.
 */
export function settledSince(openBefore: ReadonlySet<string>, openNow: PaperOrder[]): boolean {
  const stillOpen = openIds(openNow);
  return [...openBefore].some((id) => !stillOpen.has(id));
}

const openIds = (orders: PaperOrder[]) => new Set(orders.filter((o) => o.status === OrderStatus.Open).map((o) => o.id));

type LastPrices = ReadonlyMap<number, number>;

export const lastPriceLabel = (order: PaperOrder, prices: LastPrices): string => {
  const price = prices.get(order.instrumentToken);
  return price === undefined ? '-' : price.toFixed(2);
};

export const PaperOrdersTable: React.FC<{ orders: PaperOrder[]; prices: LastPrices; onCancel: (id: string) => void }> = ({ orders, prices, onCancel }) => (
  <div className="positions-table-scroll">
    <table className="positions-table">
      <thead>
        <tr>
          <th>Instrument</th>
          <th>Time</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Limit</th>
          <th>LTP</th>
          <th>Status</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => {
          const status = orderStatus(order);
          return (
            <tr key={order.id}>
              <td><PositionInstrument instrument={order} /></td>
              <td>{istTimeLabel(new Date(order.createdAt))}</td>
              <td><span className={`positions-table__side positions-table__side--${order.side.toLowerCase()}`}>{order.side}</span></td>
              <td>{order.quantity}</td>
              <td>{order.limitPrice === null ? 'Market' : order.limitPrice.toFixed(2)}</td>
              <td>{lastPriceLabel(order, prices)}</td>
              <td><Badge tone={status.tone} dot={order.status === OrderStatus.Open}>{status.text}</Badge></td>
              <td>
                {order.status === OrderStatus.Open && (
                  <button type="button" className="positions-table__exit" onClick={() => onCancel(order.id)} title="Cancel order">
                    CANCEL
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export const pendingOrders = (orders: PaperOrder[]) => orders.filter((o) => o.status === OrderStatus.Open);

export const pendingCount = (orders: PaperOrder[]) => pendingOrders(orders).length;

export interface PaperOrderBook {
  orders: PaperOrder[];
  error: string | null;
  cancel: (id: string) => Promise<void>;
}

export function usePaperOrders(onFilled: () => void): PaperOrderBook {
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const openBeforeRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchOpenOrders(signal);
      const settled = settledSince(openBeforeRef.current, next);
      openBeforeRef.current = openIds(next);
      setOrders(next);
      setError(null);
      if (settled) onFilled();
    } catch (err) {
      if (!isAbortError(err)) setError(tradeErrorMessage(err, 'Failed to load orders'));
    }
  }, [onFilled]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasOpen = orders.some((o) => o.status === OrderStatus.Open);
  useEffect(() => {
    if (!hasOpen || !isMarketLive()) return;
    const controller = new AbortController();
    const timer = setInterval(() => load(controller.signal), ORDER_REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [hasOpen, load]);

  const cancel = async (id: string) => {
    try {
      await cancelOrder(id);
      await load();
    } catch (err) {
      setError(tradeErrorMessage(err, 'Failed to cancel order'));
    }
  };

  return { orders, error, cancel };
}

const PaperOrders: React.FC<{ orders: PaperOrder[]; prices: LastPrices; error: string | null; onCancel: (id: string) => void }> = ({ orders, prices, error, onCancel }) => {
  const pending = pendingOrders(orders);
  return (
    <div className="paper-orders" role="region" aria-label="Pending orders">
      {error && <Message tone={MessageTone.Error} className="paper-orders__error">{error}</Message>}
      {pending.length > 0 ? (
        <PaperOrdersTable orders={pending} prices={prices} onCancel={onCancel} />
      ) : (
        <EmptyState
          icon={<PaperTradingIcon size={64} />}
          title="No pending orders"
          description="Limit orders, and positional orders placed while the market is closed, wait here until they fill or are cancelled."
        />
      )}
    </div>
  );
};

export default PaperOrders;
