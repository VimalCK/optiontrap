import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import TabBar from '@/components/TabBar/TabBar';
import { isTradingMode } from '../../shared/tradeEnums.js';

// Each tab is large; load it only when the tab is opened.
const OptionChain = lazy(() => import('@/components/OptionChain/OptionChain'));
const TradeJournal = lazy(() => import('@/components/TradeJournal/TradeJournal'));
const OiHistory = lazy(() => import('@/components/OiHistory/OiHistory'));
const WinLossPatterns = lazy(() => import('@/components/WinLossPatterns/WinLossPatterns'));
import '@/styles/analytics.css';

const TABS: { id: AnalyticsTabId; label: string }[] = [
  { id: AnalyticsTab.History,  label: 'OI History'       },
  { id: AnalyticsTab.Analyzer, label: 'Option Analyzer' },
  { id: AnalyticsTab.Journal,  label: 'Trade Journal'   },
  { id: AnalyticsTab.WinLoss,  label: 'Win/Loss Patterns'},
];

const getTabFromParams = (searchParams: URLSearchParams): AnalyticsTabId =>
  enumFromParam(AnalyticsTab, searchParams.get('tab'), AnalyticsTab.History);

const Analytics: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<AnalyticsTabId>(() => getTabFromParams(searchParams));
  const range = searchParams.get('range');
  const mode = searchParams.get('mode');
  const date = searchParams.get('date');
  const tradeId = searchParams.get('tradeId');

  useEffect(() => {
    setTab(getTabFromParams(searchParams));
  }, [searchParams]);

  const handleTabChange = (nextTab: AnalyticsTabId) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  return (
    <div className="analytics">
      <TabBar
        items={TABS}
        activeId={tab}
        onChange={handleTabChange}
        className="analytics-tabs"
        tabClassName="analytics-tab"
        ariaLabel="Analytics sections"
      />

      <div className="analytics-content">
        <Suspense fallback={null}>
        {tab === AnalyticsTab.Analyzer && <OptionChain />}
        {tab === AnalyticsTab.Journal && (
          <TradeJournal
            initialRange={enumFromParam(JournalRange, range, undefined)}
            initialMode={isTradingMode(mode) ? mode : undefined}
            initialDate={date ?? undefined}
            initialTradeId={tradeId ?? undefined}
          />
        )}
        {tab === AnalyticsTab.WinLoss && <WinLossPatterns />}
        {tab === AnalyticsTab.History && <OiHistory />}
        </Suspense>
      </div>
    </div>
  );
};

export default Analytics;

import { AnalyticsTab, JournalRange, enumFromParam, type AnalyticsTabId } from '@/utils/uiEnums';