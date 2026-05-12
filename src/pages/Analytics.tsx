import React from 'react';
import { AnalyticsIcon } from '@/components/icons/Icons';

const Analytics: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Analytics</h1>
        <p className="page-header__subtitle">
          Deep dive into your trading patterns and performance metrics
        </p>
      </div>
      <div className="card-grid">
        <div className="card">
          <div className="card__icon">
            <AnalyticsIcon />
          </div>
          <h3 className="card__title">Trade Journal</h3>
          <p className="card__description">
            Comprehensive log of all trades with entry/exit analysis.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <AnalyticsIcon />
          </div>
          <h3 className="card__title">Win/Loss Patterns</h3>
          <p className="card__description">
            Identify patterns in your winning and losing trades over time.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <AnalyticsIcon />
          </div>
          <h3 className="card__title">Strategy Comparison</h3>
          <p className="card__description">
            Compare performance across different trading strategies.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
