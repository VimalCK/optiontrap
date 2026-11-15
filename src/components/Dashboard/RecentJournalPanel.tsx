import React from 'react';
import Shimmer, { ShimmerGroup } from '@/components/Shimmer/Shimmer';
import { formatNumericDate } from '@/utils/marketStatus';
import { PLACEHOLDER_ROWS, formatMoney, getTone, type DashboardTradeEntry } from './dashboardMetrics';

const TradeRowsShimmer: React.FC = () => (
  <ShimmerGroup label="Loading recent trades" className="dashboard-trades">
    {PLACEHOLDER_ROWS.map((row) => (
      <div className="dashboard-trade" key={row}>
        <div>
          <strong><Shimmer width="9em" /></strong>
          <span><Shimmer width="14em" /></span>
        </div>
        <strong><Shimmer width="4em" /></strong>
      </div>
    ))}
  </ShimmerGroup>
);

const RecentJournalPanel: React.FC<{ trades: DashboardTradeEntry[]; loading: boolean; onOpenTrade: (trade: DashboardTradeEntry) => void }> = ({ trades, loading, onOpenTrade }) => (
  <div className="dashboard-panel dashboard-panel--wide">
    <div className="dashboard-panel__header">
      <div>
        <h3>Recent Journal</h3>
        <p>Latest exited paper and live trades with realised P&L.</p>
      </div>
    </div>
    {loading ? <TradeRowsShimmer /> : (
      <div className="dashboard-trades">
        {trades.length === 0 && <span className="dashboard-empty">No closed trades yet.</span>}
        {trades.map((trade) => (
          <button type="button" className="dashboard-trade dashboard-trade--clickable" key={trade.id} onClick={() => onOpenTrade(trade)}>
            <div>
              <strong>{trade.symbol}</strong>
              <span>{trade.mode.toUpperCase()} | {trade.side} x {trade.quantity} | {formatNumericDate(trade.date)}</span>
            </div>
            <strong className={`dashboard-tone--${getTone(trade.pnl).toLowerCase()}`}>{formatMoney(trade.pnl, true)}</strong>
          </button>
        ))}
      </div>
    )}
  </div>
);

export default RecentJournalPanel;
