/**
 * The trading mode (paper or live, shared/tradeEnums.js) the user last chose,
 * remembered in this browser so Positions, the Trade Journal, the Option Chain
 * order popup and Settings all start from it. One reader for all of them, so a
 * stored value that isn't a mode (e.g. one saved before the values changed)
 * falls back to paper instead of being used as a mode.
 */
import { TradingMode, isTradingMode, type TradingModeId } from '../../shared/tradeEnums.js';

const STORAGE_KEY = 'optiontrap_order_mode';

/** The remembered trading mode, or paper when none (or no valid one) is stored, or storage is unavailable. */
export function storedTradingMode(): TradingModeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTradingMode(stored) ? stored : TradingMode.Paper;
  } catch {
    return TradingMode.Paper; // no storage (private window, tests): a per-browser convenience only
  }
}

export function saveTradingMode(mode: TradingModeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // No storage: the choice still applies on this screen, just isn't remembered.
  }
}
