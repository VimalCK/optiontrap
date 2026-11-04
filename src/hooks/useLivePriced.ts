/**
 * Shared engine behind useHoldings and useLivePositions: load once (priced
 * from quotes), cancel the load when the screen closes or reloads, and keep
 * the data live from ticks while the market is open.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { getMarketStatus, MarketStatus } from '@/utils/marketStatus';

const MARKET_STATUS_CHECK_MS = 30_000;

export interface LivePricedSource<T> {
  /** Ticker subscriber name; made unique per screen. */
  name: string;
  initial: T;
  load: (signal: AbortSignal) => Promise<T>;
  tokensOf: (data: T) => number[];
  applyTicks: (data: T, ticks: Tick[]) => T;
}

export function useLivePriced<T>({ name, initial, load, tokensOf, applyTicks }: LivePricedSource<T>) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(getMarketStatus);
  const subscriberKey = `${name}-${useId()}`;
  const controllerRef = useRef<AbortController | null>(null);

  // A new load cancels the one before it; closing the screen cancels the last.
  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await load(controller.signal);
      if (!controller.signal.aborted) setData(next);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : `Failed to load ${name}`);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [load, name]);

  useEffect(() => {
    reload();
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), MARKET_STATUS_CHECK_MS);
    return () => {
      controllerRef.current?.abort();
      clearInterval(timer);
    };
  }, [reload]);

  // Subscribe again only when the set of instruments changes, not on every tick.
  const tokenKey = tokensOf(data).join(',');
  useEffect(() => {
    if (!tokenKey || marketStatus !== 'live') return;
    const tokens = tokenKey.split(',').map(Number);
    return tickerSubscribe(subscriberKey, tokens, (ticks) => setData((prev) => applyTicks(prev, ticks)));
  }, [tokenKey, marketStatus, subscriberKey, applyTicks]);

  return { data, loading, error, reload, marketStatus };
}
