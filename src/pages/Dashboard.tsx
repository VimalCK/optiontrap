import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardIcon, RefreshIcon } from '@/components/icons/Icons';
import Shimmer, { ShimmerText } from '@/components/Shimmer/Shimmer';
import MetricCard from '@/components/Dashboard/MetricCard';
import TopHoldingsPanel from '@/components/Dashboard/TopHoldingsPanel';
import RecentJournalPanel from '@/components/Dashboard/RecentJournalPanel';
import { useDashboardMetrics } from '@/components/Dashboard/useDashboardMetrics';
import { DASHBOARD_LIST_SIZE, formatCompactMoney, getTone, type DashboardTradeEntry } from '@/components/Dashboard/dashboardMetrics';
import { heldQuantity } from '@/services/holdings';
import { useHoldings } from '@/hooks/useHoldings';
import { useLivePositions } from '@/hooks/useLivePositions';
import { TradingMode } from '../../shared/tradeEnums.js';
import { saveTradingMode } from '@/utils/tradingModeStorage';
import { AnalyticsTab, JournalRange, PortfolioTab, ShimmerShape, Tone } from '@/utils/uiEnums';
import '@/styles/dashboard.css';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  const goToHoldings = () => navigate(`/portfolio?tab=${PortfolioTab.Holdings}`);
  const goToPaperPositions = () => {
    saveTradingMode(TradingMode.Paper);
    navigate(`/portfolio?tab=${PortfolioTab.Positions}&mode=${TradingMode.Paper}`);
  };
  const goToLivePositions = () => {
    saveTradingMode(TradingMode.Live);
    navigate(`/portfolio?tab=${PortfolioTab.Positions}&mode=${TradingMode.Live}`);
  };
  const goToTodayTrades = () => navigate(`/analytics?tab=${AnalyticsTab.Journal}&range=${JournalRange.Today}`);
  const goToWatchlist = () => navigate('/watchlist');
  const goToJournalTrade = (trade: DashboardTradeEntry) => {
    saveTradingMode(trade.mode);
    navigate(`/analytics?tab=${AnalyticsTab.Journal}&mode=${trade.mode}&date=${encodeURIComponent(trade.date)}&tradeId=${encodeURIComponent(trade.id)}`);
  };

  const { metrics, loading, error, reload: reloadMetrics } = useDashboardMetrics();

  // Holdings: the same source as the Portfolio page, live while the market is open.
  const holdingsData = useHoldings();
  const { currentValue: holdingsValue, investment: holdingsInvestment, pnl: holdingsPnl } = holdingsData.totals;
  const topHoldings = holdingsData.holdings
    .map((h) => ({ symbol: h.tradingsymbol, value: h.last_price * heldQuantity(h), pnl: h.pnl }))
    .sort((a, b) => b.value - a.value)
    .slice(0, DASHBOARD_LIST_SIZE)
    .map((h) => ({ ...h, weight: holdingsValue > 0 ? (h.value / holdingsValue) * 100 : 0 }));
  // Live positions: the same source as the Positions page.
  const liveData = useLivePositions();
  const livePnl = liveData.netPnl;
  const openLivePositions = liveData.openCount;

  const busy = loading || holdingsData.loading || liveData.loading;
  const refresh = () => { reloadMetrics(); holdingsData.reload(); liveData.reload(); };
  const warning = error
    ?? (holdingsData.error || liveData.error ? 'Some dashboard data could not be loaded. Showing available metrics.' : null);

  const totalPnl = holdingsPnl + metrics.tradePnl + livePnl;
  const portfolioReturn = holdingsInvestment > 0 ? (holdingsPnl / holdingsInvestment) * 100 : 0;
  const openPositions = metrics.openPaperPositions + openLivePositions;
  const tradeEdgeLabel = metrics.closedTrades === 0
    ? 'No closed paper trades yet'
    : `${metrics.winningTrades}W / ${metrics.losingTrades}L closed trades`;

  return (
    <div className="dashboard" aria-busy={busy}>
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
            <RefreshIcon size={14} strokeWidth={2.2} />
          </button>
          <div className="dashboard-hero__icon"><DashboardIcon /></div>
          <span className="dashboard-hero__label">Total Net P&L</span>
          <strong className={`dashboard-hero__value dashboard-tone--${getTone(totalPnl).toLowerCase()}`}>
            <ShimmerText loading={busy} width="5em">{formatCompactMoney(totalPnl, true)}</ShimmerText>
          </strong>
          <p className="dashboard-hero__text">Includes holdings, open/closed paper positions, and live broker positions.</p>
        </div>
        <div className="dashboard-hero__side">
          <MetricCard title="Portfolio Value" value={formatCompactMoney(holdingsValue)} detail={`${portfolioReturn >= 0 ? '+' : ''}${portfolioReturn.toFixed(2)}% holdings return`} loading={busy} />
          <MetricCard title="Open Risk" value={String(openPositions)} detail={`${metrics.openPaperPositions} paper / ${openLivePositions} live`} tone={Tone.Accent} loading={loading || liveData.loading} />
          <MetricCard title="Alert Coverage" value={String(metrics.activeAlerts)} detail={`${metrics.triggeredAlerts} triggered alerts retained`} tone={Tone.Accent} loading={loading} />
        </div>
      </section>

      <section className="dashboard-metrics-row">
        <MetricCard title="Holdings P&L" value={formatCompactMoney(holdingsPnl, true)} detail="Equity portfolio mark-to-market" tone={getTone(holdingsPnl)} loading={holdingsData.loading} onClick={goToHoldings} />
        <MetricCard title="Paper P&L" value={formatCompactMoney(metrics.tradePnl, true)} detail="Simulator and journal performance" tone={getTone(metrics.tradePnl)} loading={loading} onClick={goToPaperPositions} />
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
              { label: 'Paper', value: metrics.tradePnl },
              { label: 'Live', value: livePnl },
            ].map((item) => {
              const max = Math.max(Math.abs(holdingsPnl), Math.abs(metrics.tradePnl), Math.abs(livePnl), 1);
              const width = Math.max(4, (Math.abs(item.value) / max) * 100);
              return (
                <div className="dashboard-breakdown__row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="dashboard-breakdown__track">
                    {busy
                      ? <Shimmer shape={ShimmerShape.Block} />
                      : <div className={`dashboard-breakdown__bar dashboard-breakdown__bar--${getTone(item.value).toLowerCase()}`} style={{ width: `${width}%` }} />}
                  </div>
                  <strong className={`dashboard-tone--${getTone(item.value).toLowerCase()}`}><ShimmerText loading={busy} width="4em">{formatCompactMoney(item.value, true)}</ShimmerText></strong>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <h3>Trade Quality</h3>
              <p><ShimmerText loading={loading} width="12em">{tradeEdgeLabel}</ShimmerText></p>
            </div>
          </div>
          <div className="dashboard-quality">
            {loading
              ? <Shimmer shape={ShimmerShape.Circle} className="dashboard-quality__ring-shimmer" />
              : (
                <div className="dashboard-quality__ring" style={{ '--ring-value': `${metrics.winRate * 3.6}deg` } as React.CSSProperties}>
                  <span>{metrics.winRate.toFixed(0)}%</span>
                  <small>Win Rate</small>
                </div>
              )}
            <div className="dashboard-quality__stats">
              <span>Avg Win <strong className="dashboard-tone--positive"><ShimmerText loading={loading} width="4em">{formatCompactMoney(metrics.avgWin, true)}</ShimmerText></strong></span>
              <span>Avg Loss <strong className="dashboard-tone--negative"><ShimmerText loading={loading} width="4em">{formatCompactMoney(metrics.avgLoss, true)}</ShimmerText></strong></span>
              <span>Closed Trades <strong><ShimmerText loading={loading} width="2em">{metrics.closedTrades}</ShimmerText></strong></span>
            </div>
          </div>
        </div>

        <TopHoldingsPanel holdings={topHoldings} loading={holdingsData.loading} onClick={goToHoldings} />

        <RecentJournalPanel trades={metrics.recentTrades} loading={loading} onOpenTrade={goToJournalTrade} />

      </section>
    </div>
  );
};

export default Dashboard;