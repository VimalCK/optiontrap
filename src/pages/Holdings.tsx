/**
 * Holdings & Positions — combined tabbed page.
 * Tab 1: Holdings (equity holdings from Kite)
 * Tab 2: Positions (paper / live option positions)
 */

import React, { useState } from 'react';
import HoldingsView from './HoldingsView';
import PositionsView from './Positions';
import '@/styles/analytics.css'; // reuse same tab-bar CSS
import '@/styles/portfolio.css';

type Tab = 'holdings' | 'positions';

const Holdings: React.FC = () => {
  const [tab, setTab] = useState<Tab>('holdings');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'holdings',  label: 'Holdings'  },
    { id: 'positions', label: 'Positions' },
  ];

  return (
    <div className="portfolio">
      <div className="portfolio-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`portfolio-tab ${tab === t.id ? 'portfolio-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="portfolio-content">
        {tab === 'holdings'  && <HoldingsView />}
        {tab === 'positions' && <PositionsView hideHeader />}
      </div>
    </div>
  );
};

export default Holdings;
