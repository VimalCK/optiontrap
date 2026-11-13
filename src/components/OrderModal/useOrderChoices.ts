import { useCallback, useState } from 'react';
import { saveTradingMode, storedTradingMode } from '@/utils/tradingModeStorage';
import { Horizon, OrderType, type HorizonId, type OrderTypeId, type TradingModeId } from '../../../shared/tradeEnums.js';

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
