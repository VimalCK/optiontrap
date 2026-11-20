import { useCallback, useState } from 'react';
import { saveTradingMode, storedTradingMode } from '@/utils/tradingModeStorage';
import type { PaperOrder } from '@/services/orders';
import { Horizon, OrderType, TradingMode, type HorizonId, type OrderTypeId, type TradingModeId } from '../../../shared/tradeEnums.js';

export interface OrderChoices {
  mode: TradingModeId;
  chooseMode: (mode: TradingModeId) => void;
  orderType: OrderTypeId;
  setOrderType: (orderType: OrderTypeId) => void;
  horizon: HorizonId;
  setHorizon: (horizon: HorizonId) => void;
}

/**
 * The popup's switches, kept by the page so they carry over from one popup to the next while it stays open.
 * The trading mode is also remembered in this browser (tradingModeStorage); order type and trade type start at
 * Market and Intraday on every visit.
 */
export function useOrderChoices(): OrderChoices {
  const [mode, setMode] = useState<TradingModeId>(storedTradingMode);
  const [orderType, setOrderType] = useState<OrderTypeId>(OrderType.Market);
  const [horizon, setHorizon] = useState<HorizonId>(Horizon.Intraday);
  const chooseMode = useCallback((next: TradingModeId) => {
    setMode(next);
    saveTradingMode(next);
  }, []);
  return { mode, chooseMode, orderType, setOrderType, horizon, setHorizon };
}

const keepAsPlaced = () => {};

/**
 * The popup's switches while it modifies a pending paper order: only its order type changes; it stays a paper
 * order of the trade type it was placed with (the popup shows those switches locked).
 */
export function usePendingOrderChoices(order: PaperOrder): OrderChoices {
  const [orderType, setOrderType] = useState<OrderTypeId>(order.orderType);
  return { mode: TradingMode.Paper, chooseMode: keepAsPlaced, orderType, setOrderType, horizon: order.horizon, setHorizon: keepAsPlaced };
}
