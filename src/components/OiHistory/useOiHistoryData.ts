import { useCallback, useState } from 'react';
import { apiClient, isAbortError } from '@/services/apiClient';
import type { FuturesHistoryRow, OiHistoryRow } from './types';

/** The stored OI history and futures of a scrip over the given expiry months. */
export function useOiHistoryData(scrip: string, months: string[], signal: AbortSignal) {
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [futuresData, setFuturesData] = useState<FuturesHistoryRow[]>([]);
  // The scrip `data` belongs to. Right after a scrip switch, `scrip` is already new while `data` still holds the
  // previous scrip's rows.
  const [dataScrip, setDataScrip] = useState('');
  const [loading, setLoading] = useState(false);

  /** Loads both; resolves to the OI rows, or null when the load failed or was cancelled. */
  const load = useCallback(async (): Promise<OiHistoryRow[] | null> => {
    setLoading(true);
    try {
      const params = (month: string) => new URLSearchParams({ scrip, expiryMonth: month });
      const results = await Promise.all(months.map((month) => apiClient.get<OiHistoryRow[]>(`/api/oi-history?${params(month)}`, { signal })));
      // Futures follow the same months as OI history, including stored M-1 rows.
      const futuresResults = await Promise.all(months.map((month) => apiClient.get<FuturesHistoryRow[]>(`/api/oi-history/futures?${params(month)}`, { signal })));
      const merged = results.flat();
      setData(merged);
      setDataScrip(scrip);
      setFuturesData(futuresResults.flat());
      return merged;
    } catch (err) {
      if (!isAbortError(err)) console.error('[OiHistory] Load error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [scrip, months, signal]);

  const clear = useCallback(() => {
    setData([]);
    setDataScrip('');
  }, []);

  return { data, futuresData, dataScrip, loading, load, clear };
}
