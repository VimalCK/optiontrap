import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import TabBar from '@/components/TabBar/TabBar';

// Each tab is large; load it only when the tab is opened.
const OptionChain = lazy(() => import('@/components/OptionChain/OptionChain'));
const TradeJournal = lazy(() => import('@/components/TradeJournal/TradeJournal'));
const OiHistory = lazy(() => import('@/components/OiHistory/OiHistory'));
const WinLossPatterns = lazy(() => import('@/components/WinLossPatterns/WinLossPatterns'));
import '@/styles/analytics.css';

type AnalyticsTab = 'analyzer' | 'journal' | 'winloss' | 'history';

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'history',  label: 'OI History'       },
  { id: 'analyzer', label: 'Option Analyzer' },
  { id: 'journal',  label: 'Trade Journal'   },
  { id: 'winloss',  label: 'Win/Loss Patterns'},
];

const getTabFromParams = (searchParams: URLSearchParams): AnalyticsTab => {
  const tab = searchParams.get('tab');
  return TABS.some((item) => item.id === tab) ? tab as AnalyticsTab : 'history';
};

const Analytics: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<AnalyticsTab>(() => getTabFromParams(searchParams));
  const range = searchParams.get('range');
  const mode = searchParams.get('mode');
  const date = searchParams.get('date');
  const tradeId = searchParams.get('tradeId');

  useEffect(() => {
    setTab(getTabFromParams(searchParams));
  }, [searchParams]);

  const handleTabChange = (nextTab: AnalyticsTab) => {
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
        {tab === 'analyzer' && <OptionChain />}
        {tab === 'journal'  && (
          <TradeJournal
            initialRange={range === 'today' ? 'today' : undefined}
            initialMode={mode === 'paper' || mode === 'live' ? mode : undefined}
            initialDate={date ?? undefined}
            initialTradeId={tradeId ?? undefined}
          />
        )}
        {tab === 'winloss'  && <WinLossPatterns />}
        {tab === 'history' && <OiHistory />}
        </Suspense>
      </div>
    </div>
  );
};

export default Analytics;
