import React from 'react';
import type { StockAnalysis } from '../../../shared/stockSetups.js';
import { MARKET_LABEL, marketText, moveDirection, rupees, rsiLabel, signedPct } from './setupDetails';

/** The stock's state in words and, when the market index is known, its last 20 days against the market's. */
export const StockOverview: React.FC<{ analysis: StockAnalysis; tradingsymbol: string; marketLabel?: string | null }> = ({ analysis, tradingsymbol, marketLabel }) => (
  <section className="wl-sz-overview">
    <p className="wl-sz-overview__note">{analysis.stateNote}</p>
    {analysis.market && marketLabel && (
      <div className="wl-sz-market">
        <div className="wl-sz-stat">
          <span>{tradingsymbol} · 20d</span>
          <strong className={`wl-sz-num--${moveDirection(analysis.market.stockPct).toLowerCase()}`}>{signedPct(analysis.market.stockPct)}</strong>
        </div>
        <div className="wl-sz-stat">
          <span>{marketLabel} · 20d</span>
          <strong className={`wl-sz-num--${moveDirection(analysis.market.marketPct).toLowerCase()}`}>{signedPct(analysis.market.marketPct)}</strong>
        </div>
        <div className={`wl-sz-stat wl-sz-stat--wide wl-sz-market--${analysis.market.relation.toLowerCase()}`}>
          <span>{MARKET_LABEL[analysis.market.relation]}</span>
          <em>{marketText(analysis.market.relation, marketLabel)}</em>
        </div>
      </div>
    )}
  </section>
);

/** Moving averages, ATR and RSI (in words). */
export const IndicatorStats: React.FC<{ indicators: StockAnalysis['indicators'] }> = ({ indicators }) => {
  const rsi = indicators.rsi === null ? null : rsiLabel(indicators.rsi);
  return (
    <section className="wl-sz-indicators">
      {([
        ['20-day avg', indicators.sma20],
        ['50-day avg', indicators.sma50],
        ['200-day avg', indicators.sma200],
        ['ATR (14)', indicators.atr],
      ] as const).map(([label, value]) => (
        <div key={label} className="wl-sz-stat">
          <span>{label}</span>
          <strong>{value === null ? '—' : rupees(value)}</strong>
        </div>
      ))}
      <div className="wl-sz-stat">
        <span>RSI (14)</span>
        {rsi === null ? <strong>—</strong> : (
          <strong className={`wl-sz-rsi--${rsi.tone.toLowerCase()}`} title={`RSI ${indicators.rsi!.toFixed(0)}`}>{rsi.text}</strong>
        )}
      </div>
    </section>
  );
};
