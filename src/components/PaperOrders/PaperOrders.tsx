/**
 * Orders fill on the server, so while any is open in market hours usePaperOrders
 * reloads the list every few seconds. The page runs the hook whichever tab is
 * showing, so fills reach the positions either way. Rules: shared/orders.js.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Badge from '@/components/Badge/Badge';
import { MessageTone, Tone, type ToneId } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import EmptyState from '@/components/EmptyState/EmptyState';
import { PaperTradingIcon } from '@/components/icons/Icons';
import PositionInstrument from '@/components/PositionInstrument/PositionInstrument';
import OrderModal from '@/components/OrderModal/OrderModal';
import { pendingOrderOption, type OrderOption } from '@/components/OrderModal/orderTicket';
import { usePendingOrderChoices } from '@/components/OrderModal/useOrderChoices';
import ToastStack from '@/components/Toast/ToastStack';
import { useToasts } from '@/hooks/useToasts';
import { cancelOrder, fetchOpenOrders, type PaperOrder } from '@/services/orders';
import { tradeErrorMessage } from '@/services/positions';
import { loadInstruments, getLotSizeByToken } from '@/services/instruments';
import { getLotSize } from '@/services/optionChain';
import { isAbortError } from '@/services/apiClient';
import { istTimeLabel, isMarketLive } from '@/utils/marketStatus';
import type { ToastColorId } from '@/utils/uiEnums';
import { OrderStatus, TradeSource } from '../../../shared/tradeEnums.js';
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

/** Why an open order can't be modified, shown on its disabled Modify button; null when it can be. */
export function modifyBlockedReason(order: PaperOrder): string | null {
  if (order.source !== TradeSource.Manual) return 'Automated orders can only be cancelled';
  if (pendingOrderOption(order, order.quantity) === null) return 'Only option orders can be modified';
  return null;
}

export const PaperOrdersTable: React.FC<{
  orders: PaperOrder[];
  prices: LastPrices;
  onCancel: (id: string) => void;
  onModify: (order: PaperOrder) => void;
}> = ({ orders, prices, onCancel, onModify }) => (
  <div className="positions-table-scroll">
    <table className="positions-table">
      <thead className="sticky-head">
        <tr>
          <th>Instrument</th>
          <th>Time</th>
          <th>Side</th>
          <th className="table-num">Qty</th>
          <th className="table-num">Limit</th>
          <th className="table-num">LTP</th>
          <th>Status</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => {
          const status = orderStatus(order);
          const modifyBlocked = modifyBlockedReason(order);
          return (
            <tr key={order.id}>
              <td><PositionInstrument instrument={order} /></td>
              <td>{istTimeLabel(new Date(order.createdAt))}</td>
              <td><span className={`positions-table__side positions-table__side--${order.side.toLowerCase()}`}>{order.side}</span></td>
              <td className="table-num">{order.quantity}</td>
              <td className="table-num">{order.limitPrice === null ? 'Market' : order.limitPrice.toFixed(2)}</td>
              <td className="table-num">{lastPriceLabel(order, prices)}</td>
              <td><Badge tone={status.tone} dot={order.status === OrderStatus.Open}>{status.text}</Badge></td>
              <td>
                {order.status === OrderStatus.Open && (
                  <span className="positions-table__actions">
                    <button type="button" className="positions-table__exit positions-table__exit--modify" onClick={() => onModify(order)}
                      disabled={modifyBlocked !== null} title={modifyBlocked ?? 'Modify order'}>
                      MODIFY
                    </button>
                    <button type="button" className="positions-table__exit" onClick={() => onCancel(order.id)} title="Cancel order">
                      CANCEL
                    </button>
                  </span>
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
  /** Load the orders again, e.g. after a modify (which may have filled the order). */
  reload: () => Promise<void>;
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

  const reload = useCallback(() => load(), [load]);

  return { orders, error, cancel, reload };
}

/**
 * The order popup on a pending order, to modify it. Drawn from document.body: the orders sit in a card whose
 * hover transform would otherwise position the popup against the card and move it as the hover toggles.
 */
const ModifyOrder: React.FC<{
  order: PaperOrder;
  option: OrderOption;
  lastPrice: number;
  onClose: () => void;
  onModified: () => void;
  onToast: (text: string, color: ToastColorId) => void;
}> = ({ order, option, lastPrice, onClose, onModified, onToast }) => {
  const choices = usePendingOrderChoices(order);
  return createPortal(
    <OrderModal option={option} initialPrice={lastPrice} priceLabel="LTP" choices={choices} editing={order}
      onClose={onClose} onModified={onModified} onToast={onToast} />,
    document.body,
  );
};

/** The order's lot size from the instruments list (loaded once and cached), else the option chain's. */
async function orderLotSize(instrumentToken: number): Promise<number> {
  try {
    await loadInstruments();
  } catch {
    // The option chain's lot size stands in when the instruments list can't load.
  }
  return getLotSizeByToken(instrumentToken) ?? getLotSize(instrumentToken);
}

const PaperOrders: React.FC<{
  orders: PaperOrder[];
  prices: LastPrices;
  error: string | null;
  onCancel: (id: string) => void;
  onModified: () => void;
}> = ({ orders, prices, error, onCancel, onModified }) => {
  const pending = pendingOrders(orders);
  const { toasts, showToast } = useToasts();
  const [modifying, setModifying] = useState<{ order: PaperOrder; option: OrderOption } | null>(null);

  const openModify = async (order: PaperOrder) => {
    const option = pendingOrderOption(order, await orderLotSize(order.instrumentToken));
    if (option) setModifying({ order, option });
  };

  return (
    <div className="paper-orders" role="region" aria-label="Pending orders">
      {error && <Message tone={MessageTone.Error} className="paper-orders__error">{error}</Message>}
      {pending.length > 0 ? (
        <PaperOrdersTable orders={pending} prices={prices} onCancel={onCancel} onModify={openModify} />
      ) : (
        <EmptyState
          icon={<PaperTradingIcon size={64} />}
          title="No pending orders"
          description="Limit orders, and positional orders placed while the market is closed, wait here until they fill or are cancelled."
        />
      )}
      {modifying && (
        <ModifyOrder
          key={modifying.order.id}
          order={modifying.order}
          option={modifying.option}
          lastPrice={prices.get(modifying.order.instrumentToken) ?? modifying.order.limitPrice ?? 0}
          onClose={() => setModifying(null)}
          onModified={onModified}
          onToast={showToast}
        />
      )}
      {toasts.length > 0 && createPortal(<ToastStack toasts={toasts} />, document.body)}
    </div>
  );
};

export default PaperOrders;
