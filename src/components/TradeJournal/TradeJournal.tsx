/**
 * Trade Journal
 * P&L heatmap and per-day trade log for exited paper positions.
 *
 * Nothing loads when the page opens. A 1M / 3M / 6M / 1Y button fetches that
 * many months up to today; after that, changing From, To or the segment
 * fetches the new range. Each fetch is one P&L total per day from the server. A day's trades are fetched
 * only when that day is expanded, a page at a time, so the browser never
 * loads the full trade history.
 *
 * Mode: Paper (exited paper positions) | Live (coming soon)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import PnLHeatmap from './PnLHeatmap';
import AppSelect from '@/components/AppSelect/AppSelect';
import DateInput from '@/components/DateInput/DateInput';
import TradeSource from '@/components/TradeSource/TradeSource';
import TradeHorizon from '@/components/TradeSource/TradeHorizon';
import { formatNumericDate } from '@/utils/marketStatus';
import { marketDate } from '../../../shared/marketTime.js';
import { isDateValue, presetRange, rangeProblem, reportToFetch, subtractMonths } from './journalRange';
import {
  chargesTitle,
  getPaperDailyPnl,
  getPaperTrades,
  hasTradeMeta,
  journalTotals,
  DailyPnl,
  TradeEntry,
} from '@/services/tradeJournal';
import { Segment, TRADING_MODES, TradingMode, type SegmentId, type TradingModeId } from '../../../shared/tradeEnums.js';
import { saveTradingMode, storedTradingMode } from '@/utils/tradingModeStorage';
import '@/styles/tradejournal.css';

type SegmentFilter = 'all' | SegmentId;

/** Wait after the last filter change before fetching, so typing a date fetches once. */
const FETCH_DELAY_MS = 400;

/** Trades fetched per request when a day is expanded. */
const DAY_PAGE_SIZE = 100;

interface ReportFilters {
  from: string;
  to: string;
  segment: SegmentFilter;
}

interface DayTrades {
  trades: TradeEntry[];
  loading: boolean;
  error: string | null;
}

const segmentParam = (segment: SegmentFilter): SegmentId | undefined => (segment === 'all' ? undefined : segment);

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Could not load trades');

const formatPnl = (pnl: number) =>
  `${pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pnlClass = (pnl: number) => (pnl > 0 ? 'heatmap-positive' : pnl < 0 ? 'heatmap-negative' : '');

const TradeJournal: React.FC<{
  initialRange?: 'today';
  initialMode?: TradingModeId;
  initialDate?: string;
  initialTradeId?: string;
}> = ({
  initialRange,
  initialMode,
  initialDate,
  initialTradeId,
}) => {
  const [mode, setMode] = useState<TradingModeId>(() =>
    initialMode || storedTradingMode()
  );
  const [segment, setSegment] = useState<SegmentFilter>('all');
  const [rangeStart, setRangeStart] = useState<string>(() => subtractMonths(marketDate(), 12));
  const [rangeEnd, setRangeEnd] = useState<string>(() => marketDate());

  // The last report: its filters and one row per day. null until the first fetch.
  const [report, setReport] = useState<{ filters: ReportFilters; days: DailyPnl[] } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [dayTrades, setDayTrades] = useState<Record<string, DayTrades>>({});
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  // Bumped on every report so answers to older requests are dropped.
  const reportIdRef = useRef(0);

  const loadDay = useCallback(async (filters: ReportFilters, date: string, offset: number) => {
    const reportId = reportIdRef.current;
    setDayTrades((prev) => ({
      ...prev,
      [date]: { trades: prev[date]?.trades ?? [], loading: true, error: null },
    }));
    try {
      const trades = await getPaperTrades({
        from: date,
        to: date,
        segment: segmentParam(filters.segment),
        limit: DAY_PAGE_SIZE,
        offset,
      });
      if (reportId !== reportIdRef.current) return;
      setDayTrades((prev) => ({
        ...prev,
        [date]: { trades: [...(offset === 0 ? [] : prev[date]?.trades ?? []), ...trades], loading: false, error: null },
      }));
    } catch (err) {
      if (reportId !== reportIdRef.current) return;
      setDayTrades((prev) => ({
        ...prev,
        [date]: { trades: prev[date]?.trades ?? [], loading: false, error: errorText(err) },
      }));
    }
  }, []);

  const runReport = useCallback(async (filters: ReportFilters, expand: Set<string>) => {
    const reportId = ++reportIdRef.current;
    setReportLoading(true);
    setReportError(null);
    setDayTrades({});
    try {
      const days = await getPaperDailyPnl(filters.from, filters.to, segmentParam(filters.segment));
      if (reportId !== reportIdRef.current) return;
      setReport({ filters, days });
      // Reload the trades of days that were open and are still in the report.
      for (const day of days) {
        if (expand.has(day.date)) loadDay(filters, day.date, 0);
      }
    } catch (err) {
      if (reportId !== reportIdRef.current) return;
      setReportError(errorText(err));
    } finally {
      if (reportId === reportIdRef.current) setReportLoading(false);
    }
  }, [loadDay]);

  // A link to a specific day (e.g. a trade on the Dashboard) opens that day's
  // report, expanded; plain navigation opens the default range shown.
  useEffect(() => {
    const targetDate = isDateValue(initialDate)
      ? initialDate
      : initialRange === 'today'
        ? marketDate()
        : null;

    if (!targetDate) return;

    const expand = new Set([targetDate]);
    setRangeStart(targetDate);
    setRangeEnd(targetDate);
    setExpandedDates(expand);
    // Only when the link itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate, initialRange]);

  useEffect(() => {
    if (!initialMode) return;

    setMode(initialMode);
    saveTradingMode(initialMode);
  }, [initialMode]);

  const problem = rangeProblem(rangeStart, rangeEnd);

  // Fetch exactly the range shown (the default on opening), shortly after the last change to it.
  useEffect(() => {
    const filters = reportToFetch(mode, rangeStart, rangeEnd, segment);
    if (!filters) return;
    const timer = setTimeout(() => runReport(filters, expandedDates), FETCH_DELAY_MS);
    return () => clearTimeout(timer);
    // Expanding a day loads that day only; it doesn't refetch the range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rangeStart, rangeEnd, segment, runReport]);

  const toggleDate = (date: string) => {
    const opening = !expandedDates.has(date);
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    if (opening && report && !dayTrades[date]) loadDay(report.filters, date, 0);
  };

  const dailyPnL = new Map((report?.days ?? []).map((day) => [day.date, day.pnl]));

  return (
    <div className="tj-container">
      {/* Top Controls */}
      <div className="tj-controls">
        {/* Live / Paper toggle */}
        <div className="tj-mode-tabs">
          {TRADING_MODES.map((m) => (
            <button
              key={m}
              className={`tj-mode-tab ${mode === m ? 'tj-mode-tab--active' : ''} ${m === TradingMode.Live ? 'tj-mode-tab--live' : ''}`}
              onClick={() => setMode(m)}
            >
              <span className={`tj-mode-dot tj-mode-dot--${m}`} />
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {mode === TradingMode.Paper && (
          <>
            <AppSelect
              className="tj-segment-select"
              value={segment}
              options={[
                { value: 'all', label: 'All Segments' },
                { value: Segment.Options, label: 'Options' },
                { value: Segment.Futures, label: 'Futures' },
                { value: Segment.Stocks, label: 'Stocks' },
              ]}
              onChange={(v) => setSegment(v as SegmentFilter)}
            />

            <div className="tj-date-range">
              <span className="tj-date-label">From</span>
              <DateInput label="From" value={rangeStart} max={rangeEnd || undefined} onChange={setRangeStart} />
              <span className="tj-date-label">To</span>
              <DateInput label="To" value={rangeEnd} min={rangeStart || undefined} onChange={setRangeEnd} />
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
                    const range = presetRange(marketDate(), months);
                    setRangeStart(range.from);
                    setRangeEnd(range.to);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {reportLoading && <span className="tj-loading">Loading…</span>}
          </>
        )}
      </div>

      {/* Live — Coming Soon */}
      {mode === TradingMode.Live && (
        <div className="card tj-coming-soon">
          <div className="tj-coming-soon__icon">📡</div>
          <h4 className="tj-coming-soon__title">Live Trading Journal</h4>
          <p className="tj-coming-soon__desc">
            Live trades will be pulled from Kite Trades API once implemented.
            Switch to <strong>Paper</strong> to view your simulated trading history.
          </p>
        </div>
      )}

      {mode === TradingMode.Paper && (
        <>
          {problem && <div className="tj-notice">{problem}</div>}
          {reportError && <div className="tj-notice tj-notice--error">{reportError}</div>}

          {/* The calendar always shows; it stays empty until a report fills it. */}
          <div className="card tj-heatmap-card">
            <PnLHeatmap
              dailyPnL={dailyPnL}
              totals={journalTotals(report?.days ?? [])}
              endDate={new Date(report?.filters.to ?? rangeEnd)}
              months={12}
            />
          </div>

          {report !== null && report.days.length > 0 && (
            <div className="card">
              <h4 className="tj-section-title" style={{ marginBottom: 16 }}>Trade Log</h4>
              <table className="tj-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Segment</th>
                    <th>Side</th>
                    <th className="tj-num">Qty</th>
                    <th className="tj-num">Entry</th>
                    <th className="tj-num">Exit</th>
                    <th className="tj-num" title="What Zerodha would charge for the entry and exit">Charges</th>
                    <th className="tj-num" title="After charges">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => {
                    const isExpanded = expandedDates.has(day.date);
                    const loaded = dayTrades[day.date];
                    const shown = loaded?.trades.length ?? 0;
                    return (
                      <React.Fragment key={day.date}>
                        {/* Date group header — clickable */}
                        <tr className="tj-group-row" onClick={() => toggleDate(day.date)}>
                          <td className="tj-group-date">
                            <span className="tj-group-chevron">{isExpanded ? '▾' : '▸'}</span>
                            {formatNumericDate(day.date)}
                            <span className="tj-group-count">{day.trades} trade{day.trades !== 1 ? 's' : ''}</span>
                          </td>
                          <td className="tj-group-empty" />
                          <td className="tj-group-empty" />
                          <td className="tj-group-empty" />
                          <td className="tj-group-empty" />
                          <td className="tj-group-empty" />
                          <td className="tj-group-charges tj-num" title="The day's charges">{day.charges.toFixed(2)}</td>
                          <td className={`tj-group-pnl tj-num ${pnlClass(day.pnl)}`}>{formatPnl(day.pnl)}</td>
                        </tr>

                        {/* Individual trades — fetched when the day is expanded */}
                        {isExpanded && loaded?.trades.map((t) => (
                          <tr key={t.id} className={`tj-trade-row ${initialTradeId === t.id ? 'tj-trade-row--highlighted' : ''}`}>
                            <td className="tj-symbol">
                              <span className="tj-symbol__line">
                                {t.symbol}
                                <TradeSource source={t.source} />
                                <TradeHorizon horizon={t.horizon} />
                              </span>
                              {hasTradeMeta(t) && (
                                <div className="tj-trade-meta">
                                  {t.confidence != null && <span>Conf {t.confidence}%</span>}
                                  {t.targetPrice != null && <span>Tgt {t.targetPrice.toFixed(2)}</span>}
                                  {t.stopLossPrice != null && <span>SL {t.stopLossPrice.toFixed(2)}</span>}
                                  {t.note && <span className="tj-trade-meta__note">{t.note}</span>}
                                </div>
                              )}
                            </td>
                            <td><span className={`tj-badge tj-badge--${t.segment}`}>{t.segment}</span></td>
                            <td><span className={`tj-side tj-side--${t.side.toLowerCase()}`}>{t.side}</span></td>
                            <td className="tj-num">{t.quantity}</td>
                            <td className="tj-num">{t.entryPrice.toFixed(2)}</td>
                            <td className="tj-num">{t.exitPrice.toFixed(2)}</td>
                            <td className="tj-num" title={chargesTitle(t.chargeBreakdown)}>{t.charges.toFixed(2)}</td>
                            <td className={`tj-num ${pnlClass(t.pnl)}`}>{formatPnl(t.pnl)}</td>
                          </tr>
                        ))}

                        {isExpanded && loaded && (loaded.loading || loaded.error || shown < day.trades) && (
                          <tr className="tj-day-status-row">
                            <td colSpan={8}>
                              {loaded.loading ? (
                                <span className="tj-loading">Loading trades…</span>
                              ) : loaded.error ? (
                                <span className="tj-notice--error">{loaded.error}</span>
                              ) : (
                                <button
                                  className="tj-preset-btn"
                                  onClick={() => loadDay(report.filters, day.date, shown)}
                                >
                                  Load more ({shown} of {day.trades})
                                </button>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
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
