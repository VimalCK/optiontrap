import React from 'react';
import Shimmer, { ShimmerGroup } from '@/components/Shimmer/Shimmer';
import { PLACEHOLDER_ROWS, formatCompactMoney, getTone } from './dashboardMetrics';

export interface TopHolding {
  symbol: string;
  value: number;
  pnl: number;
  /** Share of the portfolio's current value, in %. */
  weight: number;
}

const HoldingRowsShimmer: React.FC = () => (
  <ShimmerGroup label="Loading top holdings" className="dashboard-list">
    {PLACEHOLDER_ROWS.map((row) => (
      <div className="dashboard-list__item" key={row}>
        <div>
          <strong><Shimmer width="6em" /></strong>
          <span><Shimmer width="5em" /></span>
        </div>
        <div className="dashboard-list__right">
          <strong><Shimmer width="4em" /></strong>
          <span><Shimmer width="3em" /></span>
        </div>
      </div>
    ))}
  </ShimmerGroup>
);

const TopHoldingsPanel: React.FC<{ holdings: TopHolding[]; loading: boolean; onClick: () => void }> = ({ holdings, loading, onClick }) => (
  <button type="button" className="dashboard-panel dashboard-panel--clickable" onClick={onClick}>
    <div className="dashboard-panel__header">
      <div>
        <h3>Top Holdings</h3>
        <p>Largest equity exposures by current value.</p>
      </div>
    </div>
    {loading ? <HoldingRowsShimmer /> : (
      <div className="dashboard-list">
        {holdings.length === 0 && <span className="dashboard-empty">No holdings loaded.</span>}
        {holdings.map((holding) => (
          <div className="dashboard-list__item" key={holding.symbol}>
            <div>
              <strong>{holding.symbol}</strong>
              <span>{holding.weight.toFixed(1)}% weight</span>
            </div>
            <div className="dashboard-list__right">
              <strong>{formatCompactMoney(holding.value)}</strong>
              <span className={`dashboard-tone--${getTone(holding.pnl).toLowerCase()}`}>{formatCompactMoney(holding.pnl, true)}</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </button>
);

export default TopHoldingsPanel;
