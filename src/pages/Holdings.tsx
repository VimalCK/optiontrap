import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import HoldingsView from './HoldingsView';
import PositionsView from './Positions';
import TabBar from '@/components/TabBar/TabBar';
import { isTradingMode, type TradingModeId } from '../../shared/tradeEnums.js';
import { PortfolioTab, enumFromParam, type PortfolioTabId } from '@/utils/uiEnums';
import '@/styles/analytics.css'; // reuse same tab-bar CSS
import '@/styles/portfolio.css';

const getTabFromParams = (searchParams: URLSearchParams): PortfolioTabId =>
  enumFromParam(PortfolioTab, searchParams.get('tab'), PortfolioTab.Holdings);

const getModeFromParams = (searchParams: URLSearchParams): TradingModeId | undefined => {
  const mode = searchParams.get('mode');
  return isTradingMode(mode) ? mode : undefined;
};

const Holdings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<PortfolioTabId>(() => getTabFromParams(searchParams));
  const positionsMode = getModeFromParams(searchParams);

  useEffect(() => {
    setTab(getTabFromParams(searchParams));
  }, [searchParams]);

  const handleTabChange = (nextTab: PortfolioTabId) => {
    setTab(nextTab);

    if (nextTab === PortfolioTab.Positions) {
      setSearchParams(positionsMode ? { tab: nextTab, mode: positionsMode } : { tab: nextTab });
      return;
    }

    setSearchParams({ tab: nextTab });
  };

  const TABS: { id: PortfolioTabId; label: string }[] = [
    { id: PortfolioTab.Holdings,  label: 'Holdings'  },
    { id: PortfolioTab.Positions, label: 'Positions' },
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
        {tab === PortfolioTab.Holdings  && <HoldingsView />}
        {tab === PortfolioTab.Positions && <PositionsView hideHeader initialMode={positionsMode} />}
      </div>
    </div>
  );
};

export default Holdings;