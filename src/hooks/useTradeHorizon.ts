/**
 * The trade type manual trades are placed with, remembered in this browser so
 * every trading screen starts from the last choice. Intraday until picked.
 */
import { useCallback, useState } from 'react';
import { Horizon, isHorizon, type HorizonId } from '../../shared/tradeEnums.js';

const STORAGE_KEY = 'optiontrap_trade_horizon';

export function storedTradeHorizon(): HorizonId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isHorizon(stored) ? stored : Horizon.Intraday;
  } catch {
    return Horizon.Intraday; // no storage (private window, tests): a per-browser convenience only
  }
}

export function useTradeHorizon(): [HorizonId, (horizon: HorizonId) => void] {
  const [horizon, setHorizon] = useState<HorizonId>(storedTradeHorizon);
  const choose = useCallback((next: HorizonId) => {
    setHorizon(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // No storage: the choice still applies on this screen, just isn't remembered.
    }
  }, []);
  return [horizon, choose];
}
