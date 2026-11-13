import React from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { formatCalendarDate } from '@/utils/marketStatus';

type Option = { value: string; label: string };

/** The symbol and expiry pickers, days to expiry, and the recently opened symbols. */
const ChainControls: React.FC<{
  symbol: string;
  symbolOptions: Option[];
  recentSymbolOptions: Option[];
  onSymbol: (symbol: string) => void;
  expiry: string;
  expiries: string[];
  onExpiry: (expiry: string) => void;
  daysToExpiry: number | undefined;
}> = ({ symbol, symbolOptions, recentSymbolOptions, onSymbol, expiry, expiries, onExpiry, daysToExpiry }) => (
  <div className="oc-expiry-panel">
    <div className="oc-expiry-bar">
      <AppSelect value={symbol} options={symbolOptions} onChange={(v) => onSymbol(String(v))} placeholder="Select symbol" searchable />
      {expiries.length > 0 && (
        <>
          <span className="oc-expiry-bar__label">Expiry</span>
          <AppSelect
            value={expiry}
            options={expiries.map((exp) => ({ value: exp, label: formatCalendarDate(exp, { day: '2-digit', month: 'short', year: 'numeric' }) }))}
            onChange={(v) => onExpiry(String(v))}
            className="oc-expiry-select"
          />
        </>
      )}
      {daysToExpiry !== undefined && (
        <span className="oc-expiry-bar__days">{daysToExpiry === 0 ? 'Expiry today' : `${daysToExpiry}d to expiry`}</span>
      )}
    </div>

    {recentSymbolOptions.length > 0 && (
      <div className="oc-recent-symbols" aria-label="Recently visited stocks">
        <span className="oc-recent-symbols__label">Recent</span>
        {recentSymbolOptions.map((option) => (
          <button key={option.value} type="button" className="oc-recent-symbols__chip" onClick={() => onSymbol(option.value)} title={`Switch to ${option.label}`}>
            {option.label}
          </button>
        ))}
      </div>
    )}
  </div>
);

export default ChainControls;
