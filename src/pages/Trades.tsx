import React from 'react';
import { TradesIcon } from '@/components/icons/Icons';

const Trades: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Trade Journal</h1>
        <p className="page-header__subtitle">
          Log and track your option trades with entry/exit analysis
        </p>
      </div>
      <div className="card">
        <div className="card__icon">
          <TradesIcon />
        </div>
        <h3 className="card__title">Coming Soon</h3>
        <p className="card__description">
          Record your trades, track P&L, and identify patterns in your trading behavior.
        </p>
      </div>
    </div>
  );
};

export default Trades;
