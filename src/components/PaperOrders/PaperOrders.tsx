/**
 * PaperOrders — the Pending tab of the paper positions: today's paper limit
 * orders still waiting to fill, each with a Cancel button. Filled ones show
 * as positions; cancelled ones (by hand or at the close) leave the list.
 *
 * Orders fill on the server (server/paperOrderBook.js), so while any is open
 * in market hours usePaperOrders reloads the list every few seconds; when one
 * fills, `onFilled` lets the positions reload too. The page runs the hook
 * whichever tab is showing, so fills reach the positions either way. The rules
 * are in shared/paperOrders.js.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Badge, { type BadgeTone } from '@/components/Badge/Badge';
import EmptyState from '@/components/EmptyState/EmptyState';
import { PaperTradingIcon } from '@/components/icons/Icons';
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

/** The orders still waiting to fill. */
export const pendingOrders = (orders: PaperOrder[]) => orders.filter((o) => o.status === 'open');

/** How many orders are still waiting to fill (the Pending tab's count). */
export const pendingCount = (orders: PaperOrder[]) => pendingOrders(orders).length;

export interface PaperOrderBook {
  orders: PaperOrder[];
  error: string | null;
  cancel: (id: string) => Promise<void>;
}

/**
 * Today's paper orders, reloaded every few seconds while any is open in market
 * hours; `onFilled` runs when one that was open has filled.
 */
export function usePaperOrders(onFilled: () => void): PaperOrderBook {
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

  const cancel = async (id: string) => {
    try {
      await cancelPaperOrder(id);
      await load();
    } catch (err) {
      setError(tradeErrorMessage(err, 'Failed to cancel order'));
    }
  };

  return { orders, error, cancel };
}

/**
 * The Pending tab, inside the positions card: today's orders still waiting to
 * fill (given all of today's orders), or an empty state when none are.
 */
const PaperOrders: React.FC<{ orders: PaperOrder[]; error: string | null; onCancel: (id: string) => void }> = ({ orders, error, onCancel }) => {
  const pending = pendingOrders(orders);
  return (
    <div className="paper-orders" role="region" aria-label="Pending orders">
      {error && <p className="paper-orders__error">{error}</p>}
      {pending.length > 0 ? (
        <PaperOrdersTable orders={pending} onCancel={onCancel} />
      ) : (
        <EmptyState
          icon={<PaperTradingIcon size={64} />}
          title="No pending orders"
          description="Limit orders placed from the Option Chain wait here until they fill or are cancelled."
        />
      )}
    </div>
  );
};

export default PaperOrders;
