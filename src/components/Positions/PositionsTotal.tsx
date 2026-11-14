import React from 'react';
import { ShimmerText } from '@/components/Shimmer/Shimmer';
import { formatSignedAmount } from '@/utils/formatAmount';
import { pnlTone } from './riskLabels';

/** The Total P&L card above the paper and live positions, shimmering while they load. */
const PositionsTotal: React.FC<{ pnl: number; loading?: boolean }> = ({ pnl, loading = false }) => (
  <div className="card" style={{ marginBottom: 'var(--card-gap)' }}>
    <div className="positions-summary">
      <div className="positions-summary__item">
        <span className="positions-summary__label">Total P&L</span>
        <span className={`positions-summary__value ${pnlTone(pnl)}`}>
          <ShimmerText loading={loading} width="6em">{formatSignedAmount(pnl)}</ShimmerText>
        </span>
      </div>
    </div>
  </div>
);

export default PositionsTotal;
