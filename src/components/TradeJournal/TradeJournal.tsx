/**
 * Trade Journal
 * Shows P&L heatmap derived from IndexedDB positions.
 * Mode: Paper (exited paper positions) | Live (coming soon)
 */

import React, { useState, useEffect, useCallback } from 'react';
import PnLHeatmap from './PnLHeatmap';
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
  const [mode, setMode] = useState<TradingMode>('paper');
  const [entries, setEntries] = useState<TradeEntry[]>([]);
  const [segment, setSegment] = useState<SegmentFilter>('all');
  const [rangeStart, setRangeStart] = useState<string>(() =>
    toDateStr(subtractMonths(new Date(), 12))
  );
  const [rangeEnd, setRangeEnd] = useState<string>(() => toDateStr(new Date()));
  const [loading, setLoading] = useState(true);

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
          <select
            className="tj-segment-select"
            value={segment}
            onChange={(e) => setSegment(e.target.value as SegmentFilter)}
          >
            <option value="all">All Segments</option>
            <option value="options">Options</option>
            <option value="stocks">Stocks</option>
          </select>
        )}

        {/* Date range */}
        {mode === 'paper' && (
          <>
            <div className="tj-date-range">
              <label className="tj-date-label">From</label>
              <input
                type="date"
                className="tj-date-input"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
              />
              <label className="tj-date-label">To</label>
              <input
                type="date"
                className="tj-date-input"
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

          {/* Trades Table */}
          {!loading && recentTrades.length > 0 && (
            <div className="card">
              <h4 className="tj-section-title" style={{ marginBottom: 16 }}>
                Trade Log
              </h4>
              <table className="tj-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Segment</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((t) => (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>
                        <span className={`tj-badge tj-badge--${t.segment}`}>
                          {t.segment}
                        </span>
                      </td>
                      <td className="tj-symbol">{t.symbol}</td>
                      <td>
                        <span className={`tj-side tj-side--${t.side.toLowerCase()}`}>
                          {t.side}
                        </span>
                      </td>
                      <td>{t.quantity}</td>
                      <td>{t.entryPrice.toFixed(2)}</td>
                      <td>{t.exitPrice.toFixed(2)}</td>
                      <td className={t.pnl > 0 ? 'heatmap-positive' : t.pnl < 0 ? 'heatmap-negative' : ''}>
                        {t.pnl >= 0 ? '+' : ''}
                        {t.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TradeJournal;
