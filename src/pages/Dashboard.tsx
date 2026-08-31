import React, { useCallback, useEffect, useState } from 'react';
import { DashboardIcon } from '@/components/icons/Icons';
import { fetchHoldings, fetchPositions } from '@/services/kiteApi';
import { getPositions, Position } from '@/services/positions';
import { getPaperTradeEntries, TradeEntry } from '@/services/tradeJournal';
import { loadPriceAlerts } from '@/services/priceAlerts';
import { fetchWatchlists } from '@/services/watchlist';
import '@/styles/dashboard.css';

interface DashboardMetrics {
  holdingsValue: number;
  holdingsInvestment: number;
  holdingsPnl: number;
  paperPnl: number;
  livePnl: number;
  todayTrades: number;
  watchlistCount: number;
  watchlistLists: number;
  openPaperPositions: number;
  openLivePositions: number;
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
  recentTrades: TradeEntry[];
  topHoldings: Array<{ symbol: string; value: number; pnl: number; weight: number }>;
}

const emptyMetrics: DashboardMetrics = {
  holdingsValue: 0,
  holdingsInvestment: 0,
  holdingsPnl: 0,
  paperPnl: 0,
  livePnl: 0,
  todayTrades: 0,
  watchlistCount: 0,
  watchlistLists: 0,
  openPaperPositions: 0,
  openLivePositions: 0,
  activeAlerts: 0,
  triggeredAlerts: 0,
  closedTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRate: 0,
  avgWin: 0,
  avgLoss: 0,
  recentTrades: [],
  topHoldings: [],
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

const getEffectiveHoldingQty = (holding: { t1_quantity: number; realised_quantity: number; used_quantity: number; collateral_quantity: number }) => {
  const quantity = holding.t1_quantity + holding.realised_quantity - holding.used_quantity;
  return quantity > 0 ? quantity : holding.collateral_quantity;
};

const getPaperPositionPnl = (position: Position) => {
  const exitPrice = position.exitPrice ?? position.entryPrice;
  return position.side === 'BUY'
    ? (exitPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - exitPrice) * position.quantity;
};

const isToday = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
};

const MetricCard: React.FC<{
  title: string;
  value: string;
  detail: string;
  tone?: 'positive' | 'negative' | 'neutral' | 'accent';
  loading?: boolean;
}> = ({ title, value, detail, tone = 'neutral', loading = false }) => (
  <div className="dashboard-metric">
    <span className="dashboard-metric__label">{title}</span>
    <strong className={`dashboard-metric__value dashboard-tone--${tone}`}>{loading ? 'Loading...' : value}</strong>
    <span className="dashboard-metric__detail">{detail}</span>
  </div>
);

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [holdingsResult, livePositionsResult, paperPositionsResult, paperTradesResult, watchlistsResult] = await Promise.allSettled([
        fetchHoldings(),
        fetchPositions(),
        getPositions(),
        getPaperTradeEntries(),
        fetchWatchlists(),
      ]);

      const holdings = holdingsResult.status === 'fulfilled' ? holdingsResult.value : [];
      const livePositions = livePositionsResult.status === 'fulfilled' ? livePositionsResult.value : { net: [], day: [] };
      const paperPositions = paperPositionsResult.status === 'fulfilled' ? paperPositionsResult.value : [];
      const trades = paperTradesResult.status === 'fulfilled' ? paperTradesResult.value : [];
      const watchlists = watchlistsResult.status === 'fulfilled' ? watchlistsResult.value : [];
      const alerts = loadPriceAlerts();

      const holdingRows = holdings.map((holding) => {
        const quantity = getEffectiveHoldingQty(holding);
        return {
          symbol: holding.tradingsymbol,
          value: holding.last_price * quantity,
          investment: holding.average_price * quantity,
          pnl: holding.pnl,
        };
      });

      const holdingsValue = holdingRows.reduce((sum, holding) => sum + holding.value, 0);
      const holdingsInvestment = holdingRows.reduce((sum, holding) => sum + holding.investment, 0);
      const holdingsPnl = holdingRows.reduce((sum, holding) => sum + holding.pnl, 0);
      const paperPnl = paperPositions.reduce((sum, position) => sum + getPaperPositionPnl(position), 0);
      const livePnl = livePositions.net.reduce((sum, position) => sum + position.pnl, 0);
      const winners = trades.filter((trade) => trade.pnl > 0);
      const losers = trades.filter((trade) => trade.pnl < 0);
      const avgWin = winners.length > 0 ? winners.reduce((sum, trade) => sum + trade.pnl, 0) / winners.length : 0;
      const avgLoss = losers.length > 0 ? losers.reduce((sum, trade) => sum + trade.pnl, 0) / losers.length : 0;
      const sortedByPnl = [...trades].sort((a, b) => b.pnl - a.pnl);

      setMetrics({
        holdingsValue,
        holdingsInvestment,
        holdingsPnl,
        paperPnl,
        livePnl,
        todayTrades: trades.filter((trade) => isToday(trade.date)).length,
        watchlistCount: watchlists.reduce((sum, list) => sum + list.itemCount, 0),
        watchlistLists: watchlists.length,
        openPaperPositions: paperPositions.filter((position) => !position.exited).length,
        openLivePositions: livePositions.net.filter((position) => position.quantity !== 0).length,
        activeAlerts: alerts.filter((alert) => alert.status === 'active').length,
        triggeredAlerts: alerts.filter((alert) => alert.status === 'triggered').length,
        closedTrades: trades.length,
        winningTrades: winners.length,
        losingTrades: losers.length,
        winRate: trades.length > 0 ? (winners.length / trades.length) * 100 : 0,
        avgWin,
        avgLoss,
        bestTrade: sortedByPnl[0],
        worstTrade: sortedByPnl[sortedByPnl.length - 1],
        recentTrades: trades.slice(0, 5),
        topHoldings: holdingRows
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
          .map((holding) => ({ ...holding, weight: holdingsValue > 0 ? (holding.value / holdingsValue) * 100 : 0 })),
      });

      const failed = [holdingsResult, livePositionsResult, paperPositionsResult, paperTradesResult, watchlistsResult]
        .some((result) => result.status === 'rejected');
      setError(failed ? 'Some dashboard data could not be loaded. Showing available metrics.' : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  const totalPnl = metrics.holdingsPnl + metrics.paperPnl + metrics.livePnl;
  const portfolioReturn = metrics.holdingsInvestment > 0 ? (metrics.holdingsPnl / metrics.holdingsInvestment) * 100 : 0;
  const openPositions = metrics.openPaperPositions + metrics.openLivePositions;
  const tradeEdgeLabel = metrics.closedTrades === 0
    ? 'No closed paper trades yet'
    : `${metrics.winningTrades}W / ${metrics.losingTrades}L closed trades`;

  return (
    <div className="dashboard">
      <div className="page-header dashboard-header">
        <div>
          <span className="dashboard-eyebrow">OptionTrap Command Center</span>
          <h1 className="page-header__title">Dashboard</h1>
          <p className="page-header__subtitle">Portfolio health, trade quality, alert coverage, and live risk in one view.</p>
        </div>
        <button className="dashboard-refresh" onClick={loadMetrics} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="dashboard-warning">{error}</div>}

      <section className="dashboard-hero">
        <div className="dashboard-hero__main">
          <div className="dashboard-hero__icon"><DashboardIcon /></div>
          <span className="dashboard-hero__label">Total Net P&L</span>
          <strong className={`dashboard-hero__value dashboard-tone--${getTone(totalPnl)}`}>
            {loading ? 'Loading...' : formatCompactMoney(totalPnl, true)}
          </strong>
          <p className="dashboard-hero__text">Includes holdings, open/closed paper positions, and live broker positions.</p>
        </div>
        <div className="dashboard-hero__side">
          <MetricCard title="Portfolio Value" value={formatCompactMoney(metrics.holdingsValue)} detail={`${portfolioReturn >= 0 ? '+' : ''}${portfolioReturn.toFixed(2)}% holdings return`} loading={loading} />
          <MetricCard title="Open Risk" value={String(openPositions)} detail={`${metrics.openPaperPositions} paper / ${metrics.openLivePositions} live`} tone="accent" loading={loading} />
          <MetricCard title="Alert Coverage" value={String(metrics.activeAlerts)} detail={`${metrics.triggeredAlerts} triggered alerts retained`} tone="accent" loading={loading} />
        </div>
      </section>

      <section className="dashboard-metrics-row">
        <MetricCard title="Holdings P&L" value={formatCompactMoney(metrics.holdingsPnl, true)} detail="Equity portfolio mark-to-market" tone={getTone(metrics.holdingsPnl)} loading={loading} />
        <MetricCard title="Paper P&L" value={formatCompactMoney(metrics.paperPnl, true)} detail="Simulator and journal performance" tone={getTone(metrics.paperPnl)} loading={loading} />
        <MetricCard title="Live P&L" value={formatCompactMoney(metrics.livePnl, true)} detail="Broker net positions" tone={getTone(metrics.livePnl)} loading={loading} />
        <MetricCard title="Today Trades" value={String(metrics.todayTrades)} detail="Closed paper trades today" loading={loading} />
        <MetricCard title="Watchlist" value={String(metrics.watchlistCount)} detail={`${metrics.watchlistLists} watchlist${metrics.watchlistLists === 1 ? '' : 's'}`} loading={loading} />
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
              { label: 'Holdings', value: metrics.holdingsPnl },
              { label: 'Paper', value: metrics.paperPnl },
              { label: 'Live', value: metrics.livePnl },
            ].map((item) => {
              const max = Math.max(Math.abs(metrics.holdingsPnl), Math.abs(metrics.paperPnl), Math.abs(metrics.livePnl), 1);
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

        <div className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <h3>Top Holdings</h3>
              <p>Largest equity exposures by current value.</p>
            </div>
          </div>
          <div className="dashboard-list">
            {metrics.topHoldings.length === 0 && <span className="dashboard-empty">No holdings loaded.</span>}
            {metrics.topHoldings.map((holding) => (
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
        </div>

        <div className="dashboard-panel dashboard-panel--wide">
          <div className="dashboard-panel__header">
            <div>
              <h3>Recent Journal</h3>
              <p>Latest exited paper trades with realised P&L.</p>
            </div>
          </div>
          <div className="dashboard-trades">
            {metrics.recentTrades.length === 0 && <span className="dashboard-empty">No closed paper trades yet.</span>}
            {metrics.recentTrades.map((trade) => (
              <div className="dashboard-trade" key={trade.id}>
                <div>
                  <strong>{trade.symbol}</strong>
                  <span>{trade.side} x {trade.quantity} | {trade.date}</span>
                </div>
                <strong className={`dashboard-tone--${getTone(trade.pnl)}`}>{formatMoney(trade.pnl, true)}</strong>
              </div>
            ))}
          </div>
        </div>

      </section>
    </div>
  );
};

export default Dashboard;
