/**
 * Holdings & Positions — combined tabbed page.
 * Tab 1: Holdings (equity holdings from Kite)
 * Tab 2: Positions (paper / live option positions)
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import HoldingsView from './HoldingsView';
import PositionsView from './Positions';
import TabBar from '@/components/TabBar/TabBar';
import { isTradingMode, type TradingModeId } from '../../shared/tradeEnums.js';
import '@/styles/analytics.css'; // reuse same tab-bar CSS
import '@/styles/portfolio.css';

type Tab = 'holdings' | 'positions';

const getTabFromParams = (searchParams: URLSearchParams): Tab =>
  searchParams.get('tab') === 'positions' ? 'positions' : 'holdings';

const getModeFromParams = (searchParams: URLSearchParams): TradingModeId | undefined => {
  const mode = searchParams.get('mode');
  return isTradingMode(mode) ? mode : undefined;
};

const Holdings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => getTabFromParams(searchParams));
  const positionsMode = getModeFromParams(searchParams);

  useEffect(() => {
    setTab(getTabFromParams(searchParams));
  }, [searchParams]);

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);

    if (nextTab === 'positions') {
      setSearchParams(positionsMode ? { tab: nextTab, mode: positionsMode } : { tab: nextTab });
      return;
    }

    setSearchParams({ tab: nextTab });
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'holdings',  label: 'Holdings'  },
    { id: 'positions', label: 'Positions' },
  ];

  return (
    <div className="portfolio">
      <TabBar
        items={TABS}
        activeId={tab}
        onChange={handleTabChange}
        className="portfolio-tabs"
        tabClassName="portfolio-tab"
        ariaLabel="Portfolio sections"
      />

      <div className="portfolio-content">
        {tab === 'holdings'  && <HoldingsView />}
        {tab === 'positions' && <PositionsView hideHeader initialMode={positionsMode} />}
      </div>
    </div>
  );
};

export default Holdings;
