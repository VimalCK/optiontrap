import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/services/apiClient';
import type { SignalPerformanceSummary, TradeSignalRow } from './types';
import { summarizeSignalPerformance, type SignalToLog } from './setupSignals';

/** Records each setup signal once per page load; logging must never affect the Trade Setup UI. */
export function useSignalLogging(signal: SignalToLog | null): void {
  const loggedKeys = useRef(new Set<string>());
  useEffect(() => {
    if (!signal || loggedKeys.current.has(signal.key)) return;
    loggedKeys.current.add(signal.key);
    void apiClient.post('/api/oi-history/signals', signal.body).catch(() => { /* research data only */ });
  }, [signal]);
}

/**
 * The scrip's logged setup signals and how they did, reloaded whenever `reloadKey` changes (a new chart) and after
 * a delete. `onDeleteFailed` is told when a delete fails.
 */
export function useTradeSignals(scrip: string, reloadKey: unknown, signal: AbortSignal, onDeleteFailed: () => void) {
  const [signalRows, setSignalRows] = useState<TradeSignalRow[]>([]);
  const [signalPerformance, setSignalPerformance] = useState<SignalPerformanceSummary | null>(null);
  // Bumped after a signal is deleted so the performance stats reload.
  const [signalsVersion, setSignalsVersion] = useState(0);

  useEffect(() => {
    if (!reloadKey || !scrip) return;
    void (async () => {
      try {
        const signals = (await apiClient.get<TradeSignalRow[]>(
          `/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=500`,
          { signal },
        )) || [];
        setSignalRows(signals);
        setSignalPerformance(summarizeSignalPerformance(signals));
      } catch {
        // Research metrics are optional and must never block the setup.
      }
    })();
  }, [reloadKey, scrip, signal, signalsVersion]);

  const deleteSignal = useCallback(async (id: number) => {
    try {
      await apiClient.delete(`/api/oi-history/signals/${id}`);
      setSignalRows((rows) => rows.filter((row) => row.id !== id));
      setSignalsVersion((version) => version + 1);
    } catch {
      onDeleteFailed();
    }
  }, [onDeleteFailed]);

  return { signalRows, signalPerformance, deleteSignal };
}
