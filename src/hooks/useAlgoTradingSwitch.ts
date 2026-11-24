import { useEffect, useSyncExternalStore } from 'react';
import { algoTradingSwitch, fetchAutomationConfig } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';

/**
 * Whether the user's Algo Trading is on (null until known), kept in step with every screen that reads or saves it.
 * Loads the configuration once if no screen has yet.
 */
export function useAlgoTradingSwitch(): boolean | null {
  const on = useSyncExternalStore(algoTradingSwitch.subscribe, algoTradingSwitch.current, algoTradingSwitch.current);
  useEffect(() => {
    if (algoTradingSwitch.current() !== null) return undefined;
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal).catch((err: unknown) => {
      // The state is only a hint beside the menu entry: while it can't be read it stays unknown and isn't shown.
      if (!isAbortError(err)) console.warn('Could not read the Algo Trading switch', err);
    });
    return () => controller.abort();
  }, []);
  return on;
}
