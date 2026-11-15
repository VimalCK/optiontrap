import { useCallback, useState } from 'react';
import { ApiError, apiClient, isAbortError, responseErrorMessage } from '@/services/apiClient';
import { isKiteLoginEndedReply } from '../../../shared/kiteAuth.js';
import { FetchEvent } from '../../../shared/appEnums.js';
import type { FetchProgress } from './types';
import { formatMonthShortLabel } from './helpers';
import { STRIKE_RANGE, strikeModeFor } from './oiTable';
import { readSseEvents } from './sseEvents';

interface FetchEventPayload {
  message: string;
  /** On an error event: KITE_LOGIN_ENDED when the Kite login has ended (shared/kiteAuth.js). */
  code?: string;
  pct: number;
  done: number;
  total: number;
  batch: number;
  totalBatches: number;
}

export type FetchOutcome = { ok: true } | { ok: false; loginEnded: boolean; message: string } | { ok: false; aborted: true };

/**
 * Fetches a scrip's OI history from Kite, one expiry month at a time, through the server's event stream,
 * reporting progress as it goes.
 */
export function useOiHistoryFetch(scrip: string, strikeRange: number, specificStrike: number | null, signal: AbortSignal) {
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<FetchProgress | null>(null);

  const fetchMonth = useCallback(async (month: string) => {
    const monthLabel = formatMonthShortLabel(month);
    const res = await apiClient.raw('/api/oi-history/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        scrip,
        expiryMonth: month,
        strikeMode: strikeModeFor(strikeRange),
        specificStrike: strikeRange === STRIKE_RANGE.Specific ? specificStrike : undefined,
      },
      signal,
    });
    if (!res.ok) throw new Error(await responseErrorMessage(res));
    if (!res.body) throw new Error('Server returned an empty response');

    await readSseEvents(res.body, ({ event, data }) => {
      if (!event || !data) return;
      let payload: FetchEventPayload;
      try {
        payload = JSON.parse(data);
      } catch {
        return; // ignore malformed SSE data
      }
      switch (event) {
        case FetchEvent.Step:
          setProgress({ step: `${monthLabel}: ${payload.message}`, pct: 0, detail: '' });
          break;
        case FetchEvent.Progress:
          setProgress((prev) => {
            if (prev && payload.pct < prev.pct && prev.step.startsWith(monthLabel)) return prev;
            return {
              step: `${monthLabel}: Fetching OI data...`,
              pct: payload.pct,
              detail: `${payload.done}/${payload.total} instruments (batch ${payload.batch}/${payload.totalBatches})`,
            };
          });
          break;
        case FetchEvent.Error:
          throw new ApiError(payload.message, 0, payload);
      }
    });
  }, [scrip, strikeRange, specificStrike, signal]);

  const fetchMonths = useCallback(async (months: string[]): Promise<FetchOutcome> => {
    setFetching(true);
    setProgress({ step: 'Connecting...', pct: 0, detail: '' });
    try {
      for (const month of months) await fetchMonth(month);
      setProgress(null);
      return { ok: true };
    } catch (err) {
      if (isAbortError(err)) return { ok: false, aborted: true };
      setProgress(null);
      return {
        ok: false,
        loginEnded: err instanceof ApiError && isKiteLoginEndedReply(err.body),
        message: err instanceof Error ? err.message : 'Network error',
      };
    } finally {
      setFetching(false);
    }
  }, [fetchMonth]);

  return { fetching, progress, fetchMonths };
}
