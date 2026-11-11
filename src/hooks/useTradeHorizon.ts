/**
 * The trade type (intraday or positional, shared/horizons.js) the user places
 * manual trades with, remembered in this browser so every screen that places
 * trades starts from the last choice: the Option Chain (its B/S buttons, OI
 * chart buttons, Strategy card and order popup) and OI History. Intraday until
 * the user picks otherwise.
 */
import { useCallback, useState } from 'react';
import { Horizon, isHorizon, type HorizonId } from '../../shared/horizons.js';

const STORAGE_KEY = 'optiontrap_trade_horizon';

/** The remembered trade type, or intraday when none is stored (or storage is unavailable). */
export function storedTradeHorizon(): HorizonId {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return isHorizon(stored) ? stored : Horizon.Intraday;
  } catch {
    return Horizon.Intraday; // no storage (private window, tests): a per-browser convenience only
  }
}

/** The chosen trade type and a setter that also remembers it. */
export function useTradeHorizon(): [HorizonId, (horizon: HorizonId) => void] {
  const [horizon, setHorizon] = useState<HorizonId>(storedTradeHorizon);
  const choose = useCallback((next: HorizonId) => {
    setHorizon(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // No storage: the choice still applies on this screen, just isn't remembered.
    }
  }, []);
  return [horizon, choose];
}
