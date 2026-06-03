import React from 'react';
import { TradesIcon } from '@/components/icons/Icons';

const Positions: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Positions</h1>
        <p className="page-header__subtitle">
          Track your open option positions and monitor P&L in real-time
        </p>
      </div>
      <div className="card-grid">
        <div className="card">
          <div className="card__icon">
            <TradesIcon />
          </div>
          <h3 className="card__title">Open Positions</h3>
          <p className="card__description">
            View and manage your current open option positions with live P&L tracking.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Positions;
