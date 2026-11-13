import { useEffect, useState } from 'react';
import { backfillSetupHistory, type SetupHistoryCounts } from '@/services/stockSetups';

/** Stocks whose 1Y backtest ran since the page loaded. Rerunning would only re-add the same setups; in memory only. */
const backtestedTokens = new Set<number>();

export interface BacktestState { running: boolean; message: string | null; error: boolean }

const IDLE: BacktestState = { running: false, message: null, error: false };

export const backtestMessage = (counts: SetupHistoryCounts) => (counts.found > 0
  ? `Scorecard updated: ${counts.found} setup(s) in the past year — ${counts.target} target, ${counts.stop} stop, ${counts.expired} expired, ${counts.open} open.`
  : 'No setups in the past year.');

/** The 1Y setup backtest of a stock: whether it ran this page load, its progress and result; `onDone` follows a success. */
export function useSetupBacktest(instrumentToken: number, onDone: () => void) {
  const [state, setState] = useState<BacktestState>(IDLE);
  const [backtested, setBacktested] = useState(() => backtestedTokens.has(instrumentToken));

  useEffect(() => {
    setState(IDLE);
    setBacktested(backtestedTokens.has(instrumentToken));
  }, [instrumentToken]);

  const run = async () => {
    setState({ running: true, message: null, error: false });
    try {
      const counts = await backfillSetupHistory(instrumentToken);
      backtestedTokens.add(instrumentToken);
      setBacktested(true);
      onDone();
      setState({ running: false, error: false, message: backtestMessage(counts) });
    } catch (err) {
      setState({ running: false, error: true, message: err instanceof Error ? err.message : 'Setup history failed' });
    }
  };

  return { state, backtested, run };
}
