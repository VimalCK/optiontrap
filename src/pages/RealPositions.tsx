import React from 'react';
import { TradesIcon } from '@/components/icons/Icons';

const RealPositions: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Positions</h1>
        <p className="page-header__subtitle">
          Real market positions from Kite Connect
        </p>
      </div>
      <div className="card">
        <div className="card__icon"><TradesIcon /></div>
        <h3 className="card__title">Coming Soon</h3>
        <p className="card__description">
          Real market positions will be pulled from Kite Positions API. Use Paper Trading to simulate and track positions for now.
        </p>
      </div>
    </div>
  );
};

export default RealPositions;
