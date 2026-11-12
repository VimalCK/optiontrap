import React, { useCallback, useEffect, useState } from 'react';
import { formatNumericDate } from '@/utils/marketStatus';
import { useNavigate } from 'react-router-dom';
import { DashboardIcon } from '@/components/icons/Icons';
import { heldQuantity } from '@/services/holdings';
import { useHoldings } from '@/hooks/useHoldings';
import { useLivePositions } from '@/hooks/useLivePositions';
import { getPositions, Position } from '@/services/positions';
import { getLiveTradeEntries, getPaperTradeStats, getPaperTrades, TradeEntry, TradeStats } from '@/services/tradeJournal';
import { fetchPriceAlerts } from '@/services/priceAlerts';
import { fetchWatchlists } from '@/services/watchlist';
import { Side, TradingMode, type TradingModeId } from '../../shared/tradeEnums.js';
import { PriceAlertStatus } from '../../shared/appEnums.js';
import { saveTradingMode } from '@/utils/tradingModeStorage';
import '@/styles/dashboard.css';

type DashboardTradeEntry = TradeEntry & { mode: TradingModeId };

interface DashboardMetrics {
  paperPnl: number;
  todayTrades: number;
  watchlistCount: number;
  watchlistLists: number;
  openPaperPositions: number;
  activeAlerts: number;
  triggeredAlerts: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade?: TradeEntry;
  worstTrade?: TradeEntry;
  recentTrades: DashboardTradeEntry[];
}

const emptyMetrics: DashboardMetrics = {
  paperPnl: 0,
  todayTrades: 0,
  watchlistCount: 0,
  watchlistLists: 0,
  openPaperPositions: 0,
  activeAlerts: 0,
  triggeredAlerts: 0,
  closedTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRate: 0,
  avgWin: 0,
  avgLoss: 0,
  recentTrades: [],
};

const formatMoney = (value: number, signed = false) => {
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatCompactMoney = (value: number, signed = false) => {
  const prefix = signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);
  if (abs >= 10000000) return `${prefix}${(value / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${prefix}${(value / 100000).toFixed(2)} L`;
  return formatMoney(value, signed);
};

const getTone = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';

/** A paper position's booked P&L, after charges once it has closed (open ones count 0). */
const getPaperPositionPnl = (position: Position) => {
  const exitPrice = position.exitPrice ?? position.entryPrice;
  const gross = position.side === Side.BUY
    ? (exitPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - exitPrice) * position.quantity;
  return gross - (position.charges ?? 0);
};

const MetricCard: React.FC<{
  title: string;
  value: string;
  detail: string;
  tone?: 'positive' | 'negative' | 'neutral' | 'accent';
  loading?: boolean;
  onClick?: () => void;
}> = ({ title, value, detail, tone = 'neutral', loading = false, onClick }) => {
  const content = (
    <>
      <span className="dashboard-metric__label">{title}</span>
      <strong className={`dashboard-metric__value dashboard-tone--${tone}`}>{loading ? 'Loading...' : value}</strong>
      <span className="dashboard-metric__detail">{detail}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="dashboard-metric dashboard-metric--clickable" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className="dashboard-metric">
      {content}
    </div>
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  const goToHoldings = () => navigate('/portfolio?tab=holdings');
  const goToPaperPositions = () => {
    saveTradingMode(TradingMode.Paper);
    navigate(`/portfolio?tab=positions&mode=${TradingMode.Paper}`);
  };
  const goToLivePositions = () => {
    saveTradingMode(TradingMode.Live);
    navigate(`/portfolio?tab=positions&mode=${TradingMode.Live}`);
  };
  const goToTodayTrades = () => navigate('/analytics?tab=journal&range=today');
  const goToWatchlist = () => navigate('/watchlist');
  const goToJournalTrade = (trade: DashboardTradeEntry) => {
    saveTradingMode(trade.mode);
    navigate(`/analytics?tab=journal&mode=${trade.mode}&date=${encodeURIComponent(trade.date)}&tradeId=${encodeURIComponent(trade.id)}`);
  };

  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Stats are totalled on the server, and only the 5 latest trades are
      // fetched, so the Dashboard never loads the full trade history.
      // Holdings and live positions come from useHoldings and useLivePositions,
      // shared with the Portfolio and Positions pages.
      const [paperPositionsResult, paperStatsResult, paperTradesResult, liveTradesResult, watchlistsResult, alertsResult] = await Promise.allSettled([
        getPositions(),
        getPaperTradeStats(),
        getPaperTrades({ limit: 5 }),
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
      ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
      const watchlists = watchlistsResult.status === 'fulfilled' ? watchlistsResult.value : [];
      const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];

      const paperPnl = paperPositions.reduce((sum, position) => sum + getPaperPositionPnl(position), 0);

      setMetrics({
        paperPnl,
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

  // Holdings: the same source as the Portfolio page, live while the market is open.
  const holdingsData = useHoldings();
  const { currentValue: holdingsValue, investment: holdingsInvestment, pnl: holdingsPnl } = holdingsData.totals;
  const topHoldings = holdingsData.holdings
    .map((h) => ({ symbol: h.tradingsymbol, value: h.last_price * heldQuantity(h), pnl: h.pnl }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((h) => ({ ...h, weight: holdingsValue > 0 ? (h.value / holdingsValue) * 100 : 0 }));
  // Live positions: the same source as the Positions page.
  const liveData = useLivePositions();
  const livePnl = liveData.netPnl;
  const openLivePositions = liveData.openCount;

  const busy = loading || holdingsData.loading || liveData.loading;
  const refresh = () => { loadMetrics(); holdingsData.reload(); liveData.reload(); };
  const warning = error
    ?? (holdingsData.error || liveData.error ? 'Some dashboard data could not be loaded. Showing available metrics.' : null);

  const totalPnl = holdingsPnl + metrics.paperPnl + livePnl;
  const portfolioReturn = holdingsInvestment > 0 ? (holdingsPnl / holdingsInvestment) * 100 : 0;
  const openPositions = metrics.openPaperPositions + openLivePositions;
  const tradeEdgeLabel = metrics.closedTrades === 0
    ? 'No closed paper trades yet'
    : `${metrics.winningTrades}W / ${metrics.losingTrades}L closed trades`;

  return (
    <div className="dashboard">
      {/* Title row, the height of the other pages' tab bars, so the market strip sits beside it. */}
      <header className="dashboard-header">
        <h1 className="dashboard-header__title">Dashboard</h1>
      </header>
      {warning && <div className="dashboard-warning">{warning}</div>}

      <section className="dashboard-hero">
        <div className="dashboard-hero__main">
          <button
            type="button"
            className="dashboard-refresh"
            onClick={refresh}
            disabled={busy}
            title="Refresh dashboard"
            aria-label="Refresh dashboard"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <div className="dashboard-hero__icon"><DashboardIcon /></div>
          <span className="dashboard-hero__label">Total Net P&L</span>
          <strong className={`dashboard-hero__value dashboard-tone--${getTone(totalPnl)}`}>
            {busy ? 'Loading...' : formatCompactMoney(totalPnl, true)}
          </strong>
          <p className="dashboard-hero__text">Includes holdings, open/closed paper positions, and live broker positions.</p>
        </div>
        <div className="dashboard-hero__side">
          <MetricCard title="Portfolio Value" value={formatCompactMoney(holdingsValue)} detail={`${portfolioReturn >= 0 ? '+' : ''}${portfolioReturn.toFixed(2)}% holdings return`} loading={busy} />
          <MetricCard title="Open Risk" value={String(openPositions)} detail={`${metrics.openPaperPositions} paper / ${openLivePositions} live`} tone="accent" loading={loading || liveData.loading} />
          <MetricCard title="Alert Coverage" value={String(metrics.activeAlerts)} detail={`${metrics.triggeredAlerts} triggered alerts retained`} tone="accent" loading={loading} />
        </div>
      </section>

      <section className="dashboard-metrics-row">
        <MetricCard title="Holdings P&L" value={formatCompactMoney(holdingsPnl, true)} detail="Equity portfolio mark-to-market" tone={getTone(holdingsPnl)} loading={holdingsData.loading} onClick={goToHoldings} />
        <MetricCard title="Paper P&L" value={formatCompactMoney(metrics.paperPnl, true)} detail="Simulator and journal performance" tone={getTone(metrics.paperPnl)} loading={loading} onClick={goToPaperPositions} />
        <MetricCard title="Live P&L" value={formatCompactMoney(livePnl, true)} detail="Broker net positions" tone={getTone(livePnl)} loading={liveData.loading} onClick={goToLivePositions} />
        <MetricCard title="Today Trades" value={String(metrics.todayTrades)} detail="Closed paper trades today" loading={loading} onClick={goToTodayTrades} />
        <MetricCard title="Watchlist" value={String(metrics.watchlistCount)} detail={`${metrics.watchlistLists} watchlist${metrics.watchlistLists === 1 ? '' : 's'}`} loading={loading} onClick={goToWatchlist} />
      </section>

      <section className="dashboard-content-grid">
        <div className="dashboard-panel dashboard-panel--wide">
          <div className="dashboard-panel__header">
            <div>
              <h3>Performance Breakdown</h3>
              <p>Where your current P&L is coming from.</p>
            </div>
          </div>
          <div className="dashboard-breakdown">
            {[
              { label: 'Holdings', value: holdingsPnl },
              { label: 'Paper', value: metrics.paperPnl },
              { label: 'Live', value: livePnl },
            ].map((item) => {
              const max = Math.max(Math.abs(holdingsPnl), Math.abs(metrics.paperPnl), Math.abs(livePnl), 1);
              const width = Math.max(4, (Math.abs(item.value) / max) * 100);
              return (
                <div className="dashboard-breakdown__row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="dashboard-breakdown__track">
                    <div className={`dashboard-breakdown__bar dashboard-breakdown__bar--${getTone(item.value)}`} style={{ width: `${width}%` }} />
                  </div>
                  <strong className={`dashboard-tone--${getTone(item.value)}`}>{formatCompactMoney(item.value, true)}</strong>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <h3>Trade Quality</h3>
              <p>{tradeEdgeLabel}</p>
            </div>
          </div>
          <div className="dashboard-quality">
            <div className="dashboard-quality__ring" style={{ '--ring-value': `${metrics.winRate * 3.6}deg` } as React.CSSProperties}>
              <span>{metrics.winRate.toFixed(0)}%</span>
              <small>Win Rate</small>
            </div>
            <div className="dashboard-quality__stats">
              <span>Avg Win <strong className="dashboard-tone--positive">{formatCompactMoney(metrics.avgWin, true)}</strong></span>
              <span>Avg Loss <strong className="dashboard-tone--negative">{formatCompactMoney(metrics.avgLoss, true)}</strong></span>
              <span>Closed Trades <strong>{metrics.closedTrades}</strong></span>
            </div>
          </div>
        </div>

        <button type="button" className="dashboard-panel dashboard-panel--clickable" onClick={goToHoldings}>
          <div className="dashboard-panel__header">
            <div>
              <h3>Top Holdings</h3>
              <p>Largest equity exposures by current value.</p>
            </div>
          </div>
          <div className="dashboard-list">
            {topHoldings.length === 0 && <span className="dashboard-empty">No holdings loaded.</span>}
            {topHoldings.map((holding) => (
              <div className="dashboard-list__item" key={holding.symbol}>
                <div>
                  <strong>{holding.symbol}</strong>
                  <span>{holding.weight.toFixed(1)}% weight</span>
                </div>
                <div className="dashboard-list__right">
                  <strong>{formatCompactMoney(holding.value)}</strong>
                  <span className={`dashboard-tone--${getTone(holding.pnl)}`}>{formatCompactMoney(holding.pnl, true)}</span>
                </div>
              </div>
            ))}
          </div>
        </button>

        <div className="dashboard-panel dashboard-panel--wide">
          <div className="dashboard-panel__header">
            <div>
              <h3>Recent Journal</h3>
              <p>Latest exited paper and live trades with realised P&L.</p>
            </div>
          </div>
          <div className="dashboard-trades">
            {metrics.recentTrades.length === 0 && <span className="dashboard-empty">No closed trades yet.</span>}
            {metrics.recentTrades.map((trade) => (
              <button type="button" className="dashboard-trade dashboard-trade--clickable" key={trade.id} onClick={() => goToJournalTrade(trade)}>
                <div>
                  <strong>{trade.symbol}</strong>
                  <span>{trade.mode.toUpperCase()} | {trade.side} x {trade.quantity} | {formatNumericDate(trade.date)}</span>
                </div>
                <strong className={`dashboard-tone--${getTone(trade.pnl)}`}>{formatMoney(trade.pnl, true)}</strong>
              </button>
            ))}
          </div>
        </div>

      </section>
    </div>
  );
};

export default Dashboard;
