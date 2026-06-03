/**
 * Holdings & Positions — combined tabbed page.
 * Tab 1: Holdings (equity holdings from Kite)
 * Tab 2: Positions (paper / live option positions)
 */

import React, { useState } from 'react';
import HoldingsView from './HoldingsView';
import PositionsView from './Positions';
import '@/styles/analytics.css'; // reuse same tab-bar CSS

type Tab = 'holdings' | 'positions';

const Holdings: React.FC = () => {
  const [tab, setTab] = useState<Tab>('holdings');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'holdings',  label: 'Holdings'  },
    { id: 'positions', label: 'Positions' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Holdings & Positions</h1>
        <p className="page-header__subtitle">
          Equity holdings and option positions in one place
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

      {/* Tab content — no page-header inside children since we already have one */}
      <div className="analytics-content">
        {tab === 'holdings'  && <HoldingsView />}
        {tab === 'positions' && <PositionsView hideHeader />}
      </div>
    </div>
  );
};

export default Holdings;
