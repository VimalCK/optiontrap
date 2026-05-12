import React from 'react';
import { DashboardIcon } from '@/components/icons/Icons';

const Dashboard: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Dashboard</h1>
        <p className="page-header__subtitle">
          Overview of your trading activity and market insights
        </p>
      </div>
      <div className="card-grid">
        <div className="card">
          <div className="card__icon">
            <DashboardIcon />
          </div>
          <h3 className="card__title">Market Summary</h3>
          <p className="card__description">
            Quick snapshot of major indices and market sentiment indicators.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <DashboardIcon />
          </div>
          <h3 className="card__title">Today's Activity</h3>
          <p className="card__description">
            Recent trades, alerts, and notifications from your watchlist.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <DashboardIcon />
          </div>
          <h3 className="card__title">Quick Stats</h3>
          <p className="card__description">
            Key metrics including total P&L, win rate, and risk exposure.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
