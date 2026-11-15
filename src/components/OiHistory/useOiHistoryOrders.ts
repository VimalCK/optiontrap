import { useCallback, useEffect, useState } from 'react';
import { tradeErrorMessage } from '@/services/positions';
import { placeMarketTrade, placedOrderMessage, placedOrderRefused } from '@/services/orders';
import { getLotSize } from '@/services/optionChain';
import { loadInstruments, getLotSizeByToken } from '@/services/instruments';
import { useOrderChoices } from '@/components/OrderModal/useOrderChoices';
import type { OrderOption } from '@/components/OrderModal/orderTicket';
import { Horizon, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { ToastColor, type ToastColorId } from '@/utils/uiEnums';
import type { OiCellData } from './types';
import { cellOption } from './oiTable';

/** Trading from the grid: the order popup opened on a premium, and intraday market orders from the B/S buttons. */
export function useOiHistoryOrders(showToast: (text: string, color: ToastColorId) => void) {
  const orderChoices = useOrderChoices();
  const [orderTicket, setOrderTicket] = useState<{ option: OrderOption; price: number } | null>(null);
  const closeOrder = useCallback(() => setOrderTicket(null), []);

  // Warm the instruments cache so lot sizes are available for setup trades.
  useEffect(() => {
    loadInstruments().catch(() => { /* lot size falls back to 1 if unavailable */ });
  }, []);

  const openOrder = useCallback((cell: OiCellData, optionType: OptionTypeId, strike: number, expiry: string) => {
    const { token, tradingsymbol, close } = cellOption(cell, optionType);
    if (!token || !tradingsymbol || !close) return;
    const lotSize = getLotSizeByToken(token) ?? getLotSize(token);
    setOrderTicket({ option: { tradingsymbol, instrumentToken: token, lotSize, strike, optionType, expiry }, price: close });
  }, []);

  const handleTrade = useCallback(async (cell: OiCellData, optionType: OptionTypeId, side: SideId, strike: number, expiry: string) => {
    const { token, tradingsymbol, close } = cellOption(cell, optionType);
    if (!token || !tradingsymbol || !close) return;
    try {
      // A market order: the server fills it at the live bid / ask, not the grid's historical close.
      const placed = await placeMarketTrade({
        tradingsymbol,
        instrumentToken: token,
        strike,
        optionType,
        side,
        quantity: getLotSizeByToken(token) ?? getLotSize(token),
        expiry,
        horizon: Horizon.Intraday,
      });
      showToast(placedOrderMessage(placed, `${side} ${strike}${optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
    } catch (err) {
      showToast(tradeErrorMessage(err), ToastColor.Red);
    }
  }, [showToast]);

  return { orderChoices, orderTicket, openOrder, closeOrder, handleTrade };
}
