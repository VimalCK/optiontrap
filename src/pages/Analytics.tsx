import React, { useState } from 'react';
import { AnalyticsIcon } from '@/components/icons/Icons';
import OptionChain from '@/components/OptionChain/OptionChain';
import TradeJournal from '@/components/TradeJournal/TradeJournal';
import '@/styles/analytics.css';

type AnalyticsTab = 'analyzer' | 'journal' | 'winloss';

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'analyzer', label: 'Option Analyzer' },
  { id: 'journal',  label: 'Trade Journal'   },
  { id: 'winloss',  label: 'Win/Loss Patterns'},
];

const Analytics: React.FC = () => {
  const [tab, setTab] = useState<AnalyticsTab>('analyzer');

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Analytics</h1>
        <p className="page-header__subtitle">
          Deep dive into your trading patterns and performance metrics
        </p>
      </div>

      {/* Tab bar */}
      <div className="analytics-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`analytics-tab ${tab === t.id ? 'analytics-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="analytics-content">
        {tab === 'analyzer' && <OptionChain />}
        {tab === 'journal'  && <TradeJournal />}
        {tab === 'winloss'  && (
          <div className="card analytics-coming-soon">
            <div className="card__icon"><AnalyticsIcon /></div>
            <h3 className="card__title">Win/Loss Patterns</h3>
            <p className="card__description">
              Identify patterns in your winning and losing trades over time. Coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Analytics;
