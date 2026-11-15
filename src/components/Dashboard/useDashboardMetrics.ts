import { useCallback, useEffect, useState } from 'react';
import { getPositions } from '@/services/positions';
import { getLiveTradeEntries, getPaperTradeStats, getPaperTrades, TradeStats } from '@/services/tradeJournal';
import { fetchPriceAlerts } from '@/services/priceAlerts';
import { fetchWatchlists } from '@/services/watchlist';
import { TradingMode } from '../../../shared/tradeEnums.js';
import { PriceAlertStatus } from '../../../shared/appEnums.js';
import { DASHBOARD_LIST_SIZE, emptyMetrics, getPaperPositionPnl, type DashboardMetrics, type DashboardTradeEntry } from './dashboardMetrics';

/** The Dashboard's paper trading, journal, watchlist and alert figures (holdings and live positions come from their own hooks). */
export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Stats are totalled on the server, and only the latest trades are
      // fetched, so the Dashboard never loads the full trade history.
      // Holdings and live positions come from useHoldings and useLivePositions,
      // shared with the Portfolio and Positions pages.
      const [paperPositionsResult, paperStatsResult, paperTradesResult, liveTradesResult, watchlistsResult, alertsResult] = await Promise.allSettled([
        getPositions(),
        getPaperTradeStats(),
        getPaperTrades({ limit: DASHBOARD_LIST_SIZE }),
        getLiveTradeEntries(),
        fetchWatchlists(),
        fetchPriceAlerts(),
      ]);

      const paperPositions = paperPositionsResult.status === 'fulfilled' ? paperPositionsResult.value : [];
      const paperStats: TradeStats = paperStatsResult.status === 'fulfilled'
        ? paperStatsResult.value
        : { closedTrades: 0, winningTrades: 0, losingTrades: 0, avgWin: 0, avgLoss: 0, todayTrades: 0 };
      const paperTrades = paperTradesResult.status === 'fulfilled' ? paperTradesResult.value : [];
      const liveTrades = liveTradesResult.status === 'fulfilled' ? liveTradesResult.value : [];
      const recentTrades: DashboardTradeEntry[] = [
        ...paperTrades.map((trade) => ({ ...trade, mode: TradingMode.Paper })),
        ...liveTrades.map((trade) => ({ ...trade, mode: TradingMode.Live })),
      ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, DASHBOARD_LIST_SIZE);
      const watchlists = watchlistsResult.status === 'fulfilled' ? watchlistsResult.value : [];
      const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];

      const tradePnl = paperPositions.reduce((sum, position) => sum + getPaperPositionPnl(position), 0);

      setMetrics({
        tradePnl,
        todayTrades: paperStats.todayTrades,
        watchlistCount: watchlists.reduce((sum, list) => sum + list.itemCount, 0),
        watchlistLists: watchlists.length,
        openPaperPositions: paperPositions.filter((position) => !position.exited).length,
        activeAlerts: alerts.filter((alert) => alert.status === PriceAlertStatus.Active).length,
        triggeredAlerts: alerts.filter((alert) => alert.status === PriceAlertStatus.Triggered).length,
        closedTrades: paperStats.closedTrades,
        winningTrades: paperStats.winningTrades,
        losingTrades: paperStats.losingTrades,
        winRate: paperStats.closedTrades > 0 ? (paperStats.winningTrades / paperStats.closedTrades) * 100 : 0,
        avgWin: paperStats.avgWin,
        avgLoss: paperStats.avgLoss,
        bestTrade: paperStats.bestTrade,
        worstTrade: paperStats.worstTrade,
        recentTrades,
      });

      const failed = [paperPositionsResult, paperStatsResult, paperTradesResult, liveTradesResult, watchlistsResult]
        .some((result) => result.status === 'rejected');
      setError(failed ? 'Some dashboard data could not be loaded. Showing available metrics.' : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  return { metrics, loading, error, reload: loadMetrics };
}
