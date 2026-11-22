import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PaperOrder } from '@/services/orders';
import { getLotSizeByToken, loadInstruments } from '@/services/instruments';
import { getLotSize } from '@/services/optionChain';
import type { ToastColorId } from '@/utils/uiEnums';
import OrderModal from './OrderModal';
import { pendingOrderOption } from './orderTicket';
import { usePendingOrderChoices } from './useOrderChoices';

export interface ModifyOrderModalProps {
  order: PaperOrder;
  /** The order's live last price, shown in the popup and where a market order's price field starts; its limit when unknown. */
  lastPrice?: number;
  onClose: () => void;
  /** Called after a modify was sent, whether or not it was saved, so the screen can reload. */
  onModified: () => void;
  onToast: (text: string, color: ToastColorId) => void;
}

/** The order's lot size from the instruments list (loaded once and cached), else the option chain's. */
async function orderLotSize(instrumentToken: number): Promise<number> {
  try {
    await loadInstruments();
  } catch {
    // The option chain's lot size stands in when the instruments list can't load.
  }
  return getLotSizeByToken(instrumentToken) ?? getLotSize(instrumentToken);
}

/**
 * The order popup on a pending order, to modify it: the Pending tab's and Algo Trading's. Drawn from document.body:
 * both screens list orders in a card whose hover transform would otherwise position the popup against the card and
 * move it as the hover toggles. Opens once the order's lot size is known.
 */
const ModifyOrderModal: React.FC<ModifyOrderModalProps> = ({ order, lastPrice, onClose, onModified, onToast }) => {
  const choices = usePendingOrderChoices(order);
  const [lotSize, setLotSize] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    orderLotSize(order.instrumentToken).then((size) => { if (current) setLotSize(size); });
    return () => { current = false; };
  }, [order.instrumentToken]);

  const option = lotSize === null ? null : pendingOrderOption(order, lotSize);
  if (!option) return null;
  const known = lastPrice !== undefined;
  return createPortal(
    <OrderModal option={option} initialPrice={known ? lastPrice : order.limitPrice ?? 0} priceLabel={known ? 'LTP' : 'Limit price'}
      choices={choices} editing={order} onClose={onClose} onModified={onModified} onToast={onToast} />,
    document.body,
  );
};

export default ModifyOrderModal;
