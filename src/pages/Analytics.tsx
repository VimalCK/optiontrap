import React, { useState } from 'react';
import { AnalyticsIcon } from '@/components/icons/Icons';
import OptionChain from '@/components/OptionChain/OptionChain';

type AnalyticsView = 'overview' | 'strategy';

const Analytics: React.FC = () => {
  const [view, setView] = useState<AnalyticsView>('overview');

  if (view === 'strategy') {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-header__title">Strategy Comparison</h1>
          <p className="page-header__subtitle">
            <button className="btn btn--link" onClick={() => setView('overview')} style={{ padding: 0, fontSize: 'inherit' }}>
              ← Back to Analytics
            </button>
          </p>
        </div>
        <OptionChain />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Analytics</h1>
        <p className="page-header__subtitle">
          Deep dive into your trading patterns and performance metrics
        </p>
      </div>
      <div className="card-grid">
        <div className="card card--clickable" onClick={() => setView('strategy')}>
          <div className="card__icon">
            <AnalyticsIcon />
          </div>
          <h3 className="card__title">Strategy Comparison</h3>
          <p className="card__description">
            NIFTY Option Chain with OI analysis, charts, and strike comparison.
          </p>
        </div>
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
      </div>
    </div>
  );
};

export default Analytics;
