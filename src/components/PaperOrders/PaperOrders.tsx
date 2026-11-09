/**
 * PaperOrders — today's paper limit orders, shown above the paper positions:
 * the open ones with a Cancel button, then those filled or cancelled today.
 * Hidden on a day with no orders.
 *
 * Orders fill on the server (server/paperOrderBook.js), so while any is open
 * in market hours the list is reloaded every few seconds; when one fills,
 * `onFilled` lets the positions reload too. The rules are in shared/paperOrders.js.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Badge, { type BadgeTone } from '@/components/Badge/Badge';
import PositionInstrument from '@/components/PositionInstrument/PositionInstrument';
import { cancelPaperOrder, fetchPaperOrders, type PaperOrder } from '@/services/paperOrders';
import { tradeErrorMessage } from '@/services/positions';
import { isAbortError } from '@/services/apiClient';
import { istDateString, istTimeLabel, isMarketLive } from '@/utils/marketStatus';
import '@/styles/positions.css';

/** How often open orders are reloaded in market hours, to show fills. */
const ORDER_REFRESH_MS = 5000;

/** An order's status as a badge: open (waiting), filled at its price, or why it was cancelled. */
export function orderStatus(order: PaperOrder): { tone: BadgeTone; text: string } {
  if (order.status === 'open') return { tone: 'accent', text: 'Open' };
  if (order.status === 'filled') return { tone: 'positive', text: `Filled @ ${(order.fillPrice ?? order.limitPrice).toFixed(2)}` };
  return { tone: 'neutral', text: order.statusReason ?? 'Cancelled' };
}

/** Whether any order that was open before is filled now. */
export function filledSince(openBefore: ReadonlySet<string>, orders: PaperOrder[]): boolean {
  return orders.some((o) => o.status === 'filled' && openBefore.has(o.id));
}

const openIds = (orders: PaperOrder[]) => new Set(orders.filter((o) => o.status === 'open').map((o) => o.id));

export const PaperOrdersTable: React.FC<{ orders: PaperOrder[]; onCancel: (id: string) => void }> = ({ orders, onCancel }) => (
  <div className="positions-table-scroll">
    <table className="positions-table">
      <thead>
        <tr>
          <th>Instrument</th>
          <th>Time</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Limit</th>
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
              <td>{order.limitPrice.toFixed(2)}</td>
              <td><Badge tone={status.tone} dot={order.status === 'open'}>{status.text}</Badge></td>
              <td>
                {order.status === 'open' && (
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

const PaperOrders: React.FC<{ onFilled: () => void }> = ({ onFilled }) => {
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const openBeforeRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    const today = istDateString();
    try {
      const next = await fetchPaperOrders({ from: today, to: today }, signal);
      const filled = filledSince(openBeforeRef.current, next);
      openBeforeRef.current = openIds(next);
      setOrders(next);
      setError(null);
      if (filled) onFilled();
    } catch (err) {
      if (!isAbortError(err)) setError(tradeErrorMessage(err, 'Failed to load orders'));
    }
  }, [onFilled]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasOpen = orders.some((o) => o.status === 'open');
  useEffect(() => {
    if (!hasOpen || !isMarketLive()) return;
    const controller = new AbortController();
    const timer = setInterval(() => load(controller.signal), ORDER_REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [hasOpen, load]);

  const handleCancel = async (id: string) => {
    try {
      await cancelPaperOrder(id);
      await load();
    } catch (err) {
      setError(tradeErrorMessage(err, 'Failed to cancel order'));
    }
  };

  if (orders.length === 0 && !error) return null;

  return (
    <section className="card paper-orders" aria-labelledby="paper-orders-title">
      <h3 className="card__title" id="paper-orders-title">Orders</h3>
      {error && <p className="paper-orders__error">{error}</p>}
      {orders.length > 0 && <PaperOrdersTable orders={orders} onCancel={handleCancel} />}
    </section>
  );
};

export default PaperOrders;
