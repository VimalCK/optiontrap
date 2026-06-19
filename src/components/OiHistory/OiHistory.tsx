import React, { useState, useMemo, useCallback } from 'react';
import '@/styles/oihistory.css';

interface OiHistoryRow {
  date: string;
  instrumentToken: number;
  tradingsymbol: string;
  strike: number | null;
  optionType: string | null;
  expiry: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  spotClose: number;
}

interface FetchProgress {
  step: string;
  pct: number;
  detail: string;
}

const SCRIP_OPTIONS = [
  { value: 'NIFTY50', label: 'NIFTY 50' },
];

/** Format a number with Indian locale (e.g. 11,400,000) */
const formatNum = (n: number) =>
  n.toLocaleString('en-IN');

/** Format OI change as percentage with sign */
function formatOiChg(current: number, prev: number | undefined): { text: string; cls: string } {
  if (prev === undefined || prev === 0) return { text: '-', cls: '' };
  const chg = current - prev;
  const pct = (chg / prev) * 100;
  const sign = chg > 0 ? '+' : '';
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    cls: chg > 0 ? 'oi-history__cell--up' : chg < 0 ? 'oi-history__cell--down' : '',
  };
}

/** Get today's date in YYYY-MM-DD (IST) */
function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  const d = String(ist.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Get a date N days ago in YYYY-MM-DD */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const OiHistory: React.FC = () => {
  const [scrip, setScrip] = useState('NIFTY50');
  const [fromDate, setFromDate] = useState(daysAgo(30));
  const [toDate, setToDate] = useState(todayIST());
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState<string>('');

  /** Fetch historical OI from Kite via SSE stream */
  const handleFetch = useCallback(async () => {
    setFetching(true);
    setProgress({ step: 'Connecting...', pct: 0, detail: '' });
    setFetchResult(null);
    setFetchError(null);

    try {
      const res = await fetch('/api/oi-history/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scrip, from: fromDate, to: toDate }),
      });

      if (!res.ok || !res.body) {
        setFetchError(`Server error (${res.status})`);
        setProgress(null);
        setFetching(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const payload = JSON.parse(line.slice(6));
              switch (eventType) {
                case 'step':
                  setProgress({ step: payload.message, pct: 0, detail: '' });
                  break;
                case 'progress':
                  setProgress({
                    step: `Fetching OI candles...`,
                    pct: payload.pct,
                    detail: `${payload.done}/${payload.total} instruments (batch ${payload.batch}/${payload.totalBatches})`,
                  });
                  break;
                case 'done': {
                  const parts: string[] = [];
                  if (payload.message) {
                    parts.push(payload.message);
                  } else {
                    if (payload.fetchedDays > 0) {
                      parts.push(`Fetched ${formatNum(payload.rowCount)} rows for ${payload.fetchedDays} new days`);
                    }
                    if (payload.skippedDays > 0) {
                      parts.push(`${payload.skippedDays} days already cached`);
                    }
                    if (payload.uniqueTokens > 0) {
                      parts.push(`${payload.uniqueTokens} instruments`);
                    }
                    if (parts.length === 0) {
                      parts.push('All data already cached');
                    }
                  }
                  setFetchResult(parts.join(' · '));
                  setProgress(null);
                  break;
                }
                case 'error':
                  setFetchError(payload.message);
                  setProgress(null);
                  break;
              }
            } catch {
              // ignore malformed SSE data
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
      setProgress(null);
    } finally {
      setFetching(false);
      // Auto-load data after fetch completes
      loadData();
    }
  }, [scrip, fromDate, toDate]);

  /** Load stored data from server */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scrip });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      const res = await fetch(`/api/oi-history?${params}`, { credentials: 'include' });
      const json = await res.json();
      if (json.status === 'ok') {
        setData(json.data);
        // Set filter to latest available date
        if (json.data.length > 0) {
          const dates = [...new Set(json.data.map((r: OiHistoryRow) => r.date))].sort();
          setFilterDate(dates[dates.length - 1] as string);
        }
      }
    } catch (err) {
      console.error('[OiHistory] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [scrip, fromDate, toDate]);

  /** Unique dates in the loaded data */
  const availableDates = useMemo(() => {
    const dates = [...new Set(data.map((r) => r.date))].sort();
    return dates;
  }, [data]);

  /** Filtered rows for the selected date */
  const filteredRows = useMemo(() => {
    if (!filterDate) return data;
    return data.filter((r) => r.date === filterDate);
  }, [data, filterDate]);

  /** Group by strike for the table */
  const strikeRows = useMemo(() => {
    const byStrike = new Map<number, { ce?: OiHistoryRow; pe?: OiHistoryRow; spotClose: number }>();
    for (const row of filteredRows) {
      if (!row.strike) continue;
      const existing = byStrike.get(row.strike) || { spotClose: row.spotClose };
      if (row.optionType === 'CE') existing.ce = row;
      if (row.optionType === 'PE') existing.pe = row;
      byStrike.set(row.strike, existing);
    }
    return [...byStrike.entries()]
      .sort(([a], [b]) => a - b)
      .map(([strike, { ce, pe, spotClose }]) => ({ strike, ce, pe, spotClose }));
  }, [filteredRows]);

  /** Previous day's OI per instrument token (for OI Chg column) */
  const prevDayOi = useMemo(() => {
    const map = new Map<number, number>(); // instrumentToken → OI
    if (!filterDate || availableDates.length < 2) return map;

    const idx = availableDates.indexOf(filterDate);
    if (idx <= 0) return map; // no previous day available

    const prevDate = availableDates[idx - 1];
    for (const row of data) {
      if (row.date === prevDate) {
        map.set(row.instrumentToken, row.oi);
      }
    }
    return map;
  }, [data, filterDate, availableDates]);

  /** ATM strike for the selected date */
  const atmStrike = useMemo(() => {
    if (strikeRows.length === 0) return null;
    const spot = strikeRows[0].spotClose;
    return Math.round(spot / 50) * 50;
  }, [strikeRows]);

  return (
    <div className="oi-history">
      {/* Controls */}
      <div className="oi-history__controls card">
        <div className="oi-history__control-row">
          <label className="oi-history__label">
            Script
            <select
              className="oi-history__select"
              value={scrip}
              onChange={(e) => setScrip(e.target.value)}
              disabled={fetching}
            >
              {SCRIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="oi-history__label">
            From
            <input
              type="date"
              className="oi-history__date-input"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            To
            <input
              type="date"
              className="oi-history__date-input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={fetching}
            />
          </label>

          <button
            className="oi-history__btn oi-history__btn--fetch"
            onClick={handleFetch}
            disabled={fetching}
          >
            {fetching ? 'Fetching...' : 'Fetch'}
          </button>
        </div>

        {/* Progress bar */}
        {progress && (
          <div className="oi-history__progress">
            <div className="oi-history__progress-header">
              <span className="oi-history__progress-step">{progress.step}</span>
              {progress.pct > 0 && (
                <span className="oi-history__progress-pct">{progress.pct}%</span>
              )}
            </div>
            <div className="oi-history__progress-track">
              <div
                className="oi-history__progress-fill"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            {progress.detail && (
              <span className="oi-history__progress-detail">{progress.detail}</span>
            )}
          </div>
        )}

        {/* Result / Error */}
        {fetchResult && !progress && (
          <div className="oi-history__status">{fetchResult}</div>
        )}
        {fetchError && !progress && (
          <div className="oi-history__status oi-history__status--error">{fetchError}</div>
        )}
      </div>

      {/* Date filter */}
      {availableDates.length > 0 && (
        <div className="oi-history__date-bar">
          {availableDates.map((d) => (
            <button
              key={d}
              className={`oi-history__date-btn ${filterDate === d ? 'oi-history__date-btn--active' : ''}`}
              onClick={() => setFilterDate(d)}
            >
              {d.slice(5)} {/* MM-DD */}
            </button>
          ))}
        </div>
      )}

      {/* Data table */}
      {strikeRows.length > 0 && (
        <div className="oi-history__table-wrap card">
          <div className="oi-history__table-header">
            <span className="oi-history__table-title">
              {filterDate} &mdash; Spot: {formatNum(strikeRows[0].spotClose)}
            </span>
            <span className="oi-history__table-count">
              {strikeRows.length} strikes
            </span>
          </div>

          <div className="oi-history__table-scroll">
            <table className="oi-history__table">
              <thead>
                <tr>
                  <th colSpan={4} className="oi-history__th-group oi-history__th-group--ce">CE</th>
                  <th className="oi-history__th-strike">Strike</th>
                  <th colSpan={4} className="oi-history__th-group oi-history__th-group--pe">PE</th>
                </tr>
                <tr>
                  <th>OI</th>
                  <th>Volume</th>
                  <th>Close</th>
                  <th>OI Chg</th>
                  <th></th>
                  <th>OI</th>
                  <th>Volume</th>
                  <th>Close</th>
                  <th>OI Chg</th>
                </tr>
              </thead>
              <tbody>
                {strikeRows.map(({ strike, ce, pe }) => {
                  const isAtm = strike === atmStrike;
                  const ceChg = ce ? formatOiChg(ce.oi, prevDayOi.get(ce.instrumentToken)) : { text: '-', cls: '' };
                  const peChg = pe ? formatOiChg(pe.oi, prevDayOi.get(pe.instrumentToken)) : { text: '-', cls: '' };
                  return (
                    <tr key={strike} className={isAtm ? 'oi-history__row--atm' : ''}>
                      <td className="oi-history__cell--ce">{ce ? formatNum(ce.oi) : '-'}</td>
                      <td className="oi-history__cell--ce">{ce ? formatNum(ce.volume) : '-'}</td>
                      <td className="oi-history__cell--ce">{ce ? ce.close.toFixed(2) : '-'}</td>
                      <td className={ceChg.cls}>{ceChg.text}</td>
                      <td className="oi-history__cell--strike">{strike}</td>
                      <td className="oi-history__cell--pe">{pe ? formatNum(pe.oi) : '-'}</td>
                      <td className="oi-history__cell--pe">{pe ? formatNum(pe.volume) : '-'}</td>
                      <td className="oi-history__cell--pe">{pe ? pe.close.toFixed(2) : '-'}</td>
                      <td className={peChg.cls}>{peChg.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.length === 0 && !loading && !fetching && (
        <div className="oi-history__empty card">
          Select a script and date range, then click <strong>Fetch</strong> to download historical OI data.
          Already-fetched days are skipped automatically.
        </div>
      )}
    </div>
  );
};

export default OiHistory;
