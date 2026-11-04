/**
 * The one source of holdings for every screen (Portfolio, Dashboard): loaded
 * once, priced from quotes, then kept live from ticks while the market is
 * open. Every figure comes from src/services/holdings.ts, so two screens
 * showing holdings always agree.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Holding } from '@/services/kiteApi';
import { applyTicks, fetchPricedHoldings, holdingTotals } from '@/services/holdings';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { getMarketStatus, MarketStatus } from '@/utils/marketStatus';

const MARKET_STATUS_CHECK_MS = 30_000;

export function useHoldings() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(getMarketStatus);
  const subscriberKey = `holdings-${useId()}`;
  const controllerRef = useRef<AbortController | null>(null);

  // A new load cancels the one before it; closing the screen cancels the last.
  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPricedHoldings(controller.signal);
      if (!controller.signal.aborted) setHoldings(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Failed to load holdings');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), MARKET_STATUS_CHECK_MS);
    return () => {
      controllerRef.current?.abort();
      clearInterval(timer);
    };
  }, [reload]);

  // Subscribe again only when the set of holdings changes, not on every tick.
  const tokenKey = holdings.map((h) => h.instrument_token).join(',');
  useEffect(() => {
    if (!tokenKey || marketStatus !== 'live') return;
    const tokens = tokenKey.split(',').map(Number);
    return tickerSubscribe(subscriberKey, tokens, (ticks) => setHoldings((prev) => applyTicks(prev, ticks)));
  }, [tokenKey, marketStatus, subscriberKey]);

  const totals = useMemo(() => holdingTotals(holdings), [holdings]);

  return { holdings, totals, loading, error, reload, marketStatus };
}
