/**
 * Trade Journal
 * Shows P&L heatmap derived from IndexedDB positions.
 * Mode: Paper (exited paper positions) | Live (coming soon)
 */

import React, { useState, useEffect, useCallback } from 'react';
import PnLHeatmap from './PnLHeatmap';
import AppSelect from '@/components/AppSelect/AppSelect';
import {
  getPaperTradeEntries,
  getLiveTradeEntries,
  aggregateDailyPnL,
  TradeEntry,
  TradingMode,
  Segment,
} from '@/services/tradeJournal';
import '@/styles/tradejournal.css';

type SegmentFilter = 'all' | Segment;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subtractMonths(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() - n);
  return copy;
}

const TradeJournal: React.FC = () => {
  const [mode, setMode] = useState<TradingMode>(() =>
    (localStorage.getItem('optiontrap_order_mode') as TradingMode) || 'paper'
  );
  const [entries, setEntries] = useState<TradeEntry[]>([]);
  const [segment, setSegment] = useState<SegmentFilter>('all');
  const [rangeStart, setRangeStart] = useState<string>(() =>
    toDateStr(subtractMonths(new Date(), 12))
  );
  const [rangeEnd, setRangeEnd] = useState<string>(() => toDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const load = useCallback(async (m: TradingMode) => {
    setLoading(true);
    const data = m === 'paper'
      ? await getPaperTradeEntries()
      : await getLiveTradeEntries();
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(mode); }, [load, mode]);

  const handleModeSwitch = (m: TradingMode) => {
    setMode(m);
  };

  // Filtered entries
  const filteredEntries = entries.filter((e) => {
    if (segment !== 'all' && e.segment !== segment) return false;
    if (e.date < rangeStart || e.date > rangeEnd) return false;
    return true;
  });

  const dailyPnL = aggregateDailyPnL(filteredEntries);

  // Recent trades sorted by date desc
  const recentTrades = [...filteredEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50);

  return (
    <div className="tj-container">
      {/* Top Controls */}
      <div className="tj-controls">
        {/* Live / Paper toggle */}
        <div className="tj-mode-tabs">
          {(['paper', 'live'] as TradingMode[]).map((m) => (
            <button
              key={m}
              className={`tj-mode-tab ${mode === m ? 'tj-mode-tab--active' : ''} ${m === 'live' ? 'tj-mode-tab--live' : ''}`}
              onClick={() => handleModeSwitch(m)}
            >
              <span className={`tj-mode-dot tj-mode-dot--${m}`} />
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Segment filter — only relevant for paper mode */}
        {mode === 'paper' && (
          <AppSelect
            className="tj-segment-select"
            value={segment}
            options={[
              { value: 'all', label: 'All Segments' },
              { value: 'options', label: 'Options' },
              { value: 'stocks', label: 'Stocks' },
            ]}
            onChange={(v) => setSegment(v as SegmentFilter)}
          />
        )}

        {/* Date range */}
        {mode === 'paper' && (
          <>
            <div className="tj-date-range">
              <label className="tj-date-label">From</label>
              <input
                type="date"
                className="app-date-input"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
              />
              <label className="tj-date-label">To</label>
              <input
                type="date"
                className="app-date-input"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
              />
            </div>

            <div className="tj-presets">
              {[
                { label: '1M', months: 1 },
                { label: '3M', months: 3 },
                { label: '6M', months: 6 },
                { label: '1Y', months: 12 },
              ].map(({ label, months }) => (
                <button
                  key={label}
                  className="tj-preset-btn"
                  onClick={() => {
                    const end = new Date();
                    setRangeEnd(toDateStr(end));
                    setRangeStart(toDateStr(subtractMonths(end, months)));
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Live — Coming Soon */}
      {mode === 'live' && (
        <div className="card tj-coming-soon">
          <div className="tj-coming-soon__icon">📡</div>
          <h4 className="tj-coming-soon__title">Live Trading Journal</h4>
          <p className="tj-coming-soon__desc">
            Live trades will be pulled from Kite Trades API once implemented.
            Switch to <strong>Paper</strong> to view your simulated trading history.
          </p>
        </div>
      )}

      {/* Paper — Heatmap */}
      {mode === 'paper' && (
        <>
          <div className="card tj-heatmap-card">
            {loading ? (
              <div className="tj-loading">Loading positions...</div>
            ) : entries.length === 0 ? (
              <div className="tj-empty">
                <span className="tj-empty__icon">📭</span>
                <p className="tj-empty__text">No exited paper trades yet.</p>
                <p className="tj-empty__hint">
                  Exit positions in the <strong>Paper Trading</strong> page to see them here.
                </p>
              </div>
            ) : (
              <PnLHeatmap
                dailyPnL={dailyPnL}
                endDate={new Date(rangeEnd)}
                months={12}
              />
            )}
          </div>

          {/* Trades Table — grouped by date, collapsible */}
          {!loading && recentTrades.length > 0 && (() => {
            // Group trades by date
            const groups = recentTrades.reduce<Record<string, TradeEntry[]>>((acc, t) => {
              (acc[t.date] = acc[t.date] || []).push(t);
              return acc;
            }, {});

            return (
              <div className="card">
                <h4 className="tj-section-title" style={{ marginBottom: 16 }}>Trade Log</h4>
                <table className="tj-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Segment</th>
                      <th>Side</th>
                      <th>Qty</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(groups).map(([date, trades]) => {
                      const dayTotal = trades.reduce((s, t) => s + t.pnl, 0);
                      const isExpanded = expandedDates.has(date);
                      return (
                        <React.Fragment key={date}>
                          {/* Date group header — clickable */}
                          <tr
                            className="tj-group-row"
                            onClick={() => toggleDate(date)}
                          >
                            <td className="tj-group-date">
                              <span className="tj-group-chevron">{isExpanded ? '▾' : '▸'}</span>
                              {date}
                              <span className="tj-group-count">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
                            </td>
                            <td className="tj-group-empty" />
                            <td className="tj-group-empty" />
                            <td className="tj-group-empty" />
                            <td className="tj-group-empty" />
                            <td className="tj-group-empty" />
                            <td className={`tj-group-pnl ${dayTotal > 0 ? 'heatmap-positive' : dayTotal < 0 ? 'heatmap-negative' : ''}`}>
                              {dayTotal >= 0 ? '+' : ''}
                              {dayTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                          {/* Individual trades — only shown when expanded */}
                          {isExpanded && trades.map((t) => (
                            <tr key={t.id} className="tj-trade-row">
                              <td className="tj-symbol">
                                {t.symbol}
                                {(t.strategyTag || t.confidence != null || t.targetPrice != null || t.stopLossPrice != null || t.note) && (
                                  <div className="tj-trade-meta">
                                    {t.strategyTag && <span className="tj-trade-meta__tag">{t.strategyTag}</span>}
                                    {t.confidence != null && <span>Conf {t.confidence}%</span>}
                                    {t.targetPrice != null && <span>Tgt {t.targetPrice.toFixed(2)}</span>}
                                    {t.stopLossPrice != null && <span>SL {t.stopLossPrice.toFixed(2)}</span>}
                                    {t.note && <span className="tj-trade-meta__note">{t.note}</span>}
                                  </div>
                                )}
                              </td>
                              <td><span className={`tj-badge tj-badge--${t.segment}`}>{t.segment}</span></td>
                              <td><span className={`tj-side tj-side--${t.side.toLowerCase()}`}>{t.side}</span></td>
                              <td>{t.quantity}</td>
                              <td>{t.entryPrice.toFixed(2)}</td>
                              <td>{t.exitPrice.toFixed(2)}</td>
                              <td className={t.pnl > 0 ? 'heatmap-positive' : t.pnl < 0 ? 'heatmap-negative' : ''}>
                                {t.pnl >= 0 ? '+' : ''}
                                {t.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default TradeJournal;
