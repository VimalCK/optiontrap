import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeStock, type StockAnalysis } from '../../../shared/stockSetups.js';
import { fetchExpectedMove, fetchStockCandles, type ExpectedMove, type StockCandles } from '@/services/stockSetups';
import { isAbortError } from '@/services/apiClient';
import { realisedVolatility, sessionsTo, straddleDailyMove, type Volatility } from './setupDetails';

/** Re-run the analysis only when the live price has moved this much: zones don't change tick by tick. */
const REPRICE_MOVE = 0.005;

export interface StockSetups {
  data: StockCandles | null;
  error: string | null;
  analysis: StockAnalysis | null;
  expectedMove: ExpectedMove | null;
  /** The straddle's move per session, comparable with the usual daily move. */
  expectedDaily: number | null;
  volatility: Volatility | null;
}

/** A stock's daily candles and their analysis at the live price (the last close without one), with the options' expected move. */
export function useStockSetups(instrumentToken: number, tradingsymbol: string, livePrice: number | undefined): StockSetups {
  const [data, setData] = useState<StockCandles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisPrice, setAnalysisPrice] = useState<number | undefined>(livePrice);
  const [expectedMove, setExpectedMove] = useState<ExpectedMove | null>(null);
  // Read once for the ATM strike; ticks shouldn't refetch option quotes.
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    fetchStockCandles(instrumentToken, controller.signal)
      .then(setData)
      .catch((err) => { if (!isAbortError(err)) setError(err instanceof Error ? err.message : 'Failed to load candles'); });
    return () => controller.abort();
  }, [instrumentToken]);

  useEffect(() => {
    if (livePrice === undefined) return;
    setAnalysisPrice((prev) => (prev === undefined || Math.abs(livePrice / prev - 1) >= REPRICE_MOVE ? livePrice : prev));
  }, [livePrice]);

  const analysis = useMemo(
    () => (data ? analyzeStock(data.candles, { price: analysisPrice, market: data.market }) : null),
    [data, analysisPrice],
  );

  // Fetched once the candles give a price to pick the ATM strike.
  useEffect(() => {
    setExpectedMove(null);
    const price = livePriceRef.current ?? data?.candles[data.candles.length - 1]?.close;
    if (!price) return;
    const controller = new AbortController();
    fetchExpectedMove(tradingsymbol, price, controller.signal)
      .then(setExpectedMove)
      .catch((err) => { if (!isAbortError(err)) console.warn('[StockSetups] Expected move unavailable:', err); });
    return () => controller.abort();
  }, [tradingsymbol, data]);

  const volatility = useMemo(
    () => (data && analysis ? realisedVolatility(data.candles.map((c) => c.close), analysis.price) : null),
    [data, analysis],
  );

  const expectedDaily = useMemo(
    () => (expectedMove ? straddleDailyMove(expectedMove.straddle, sessionsTo(expectedMove.expiry)) : null),
    [expectedMove],
  );

  return { data, error, analysis, expectedMove, expectedDaily, volatility };
}
