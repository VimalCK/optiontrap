import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnalyticsIcon } from '@/components/icons/Icons';
import OptionChain from '@/components/OptionChain/OptionChain';
import TradeJournal from '@/components/TradeJournal/TradeJournal';
import OiHistory from '@/components/OiHistory/OiHistory';
import '@/styles/analytics.css';

type AnalyticsTab = 'analyzer' | 'journal' | 'winloss' | 'history';

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'analyzer', label: 'Option Analyzer' },
  { id: 'history',  label: 'OI History'       },
  { id: 'journal',  label: 'Trade Journal'   },
  { id: 'winloss',  label: 'Win/Loss Patterns'},
];

const getTabFromParams = (searchParams: URLSearchParams): AnalyticsTab => {
  const tab = searchParams.get('tab');
  return TABS.some((item) => item.id === tab) ? tab as AnalyticsTab : 'analyzer';
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
      <div className="analytics-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`analytics-tab ${tab === t.id ? 'analytics-tab--active' : ''}`}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="analytics-content">
        {tab === 'analyzer' && <OptionChain />}
        {tab === 'journal'  && (
          <TradeJournal
            initialRange={range === 'today' ? 'today' : undefined}
            initialMode={mode === 'paper' || mode === 'live' ? mode : undefined}
            initialDate={date ?? undefined}
            initialTradeId={tradeId ?? undefined}
          />
        )}
        {tab === 'winloss'  && (
          <div className="card analytics-coming-soon">
            <div className="card__icon"><AnalyticsIcon /></div>
            <h3 className="card__title">Win/Loss Patterns</h3>
            <p className="card__description">
              Identify patterns in your winning and losing trades over time. Coming soon.
            </p>
          </div>
        )}
        {tab === 'history' && <OiHistory />}
      </div>
    </div>
  );
};

export default Analytics;
