import React, { useState, useMemo, useCallback } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
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

type RolloverPattern =
  | 'Rolling Over'
  | 'Exiting'
  | 'Fresh Build'
  | 'Doubling Down'
  | 'Unwinding'
  | 'Stable'
  | '-';

const SCRIP_OPTIONS = [{ value: 'NIFTY50', label: 'NIFTY 50' }];

/** Format a number with Indian locale (e.g. 11,400,000) */
const formatNum = (n: number) => n.toLocaleString('en-IN');

/** Compact OI display: 11,400,000 → 11.4M, 850,000 → 850K */
function formatOiCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Format OI with change: "1.9M (+37%)" */
function formatOiWithChg(oi: number, prev: number | undefined): { text: string; chgCls: string } {
  if (oi === 0) return { text: '-', chgCls: '' };
  const oiStr = formatOiCompact(oi);
  if (prev === undefined || prev === 0) return { text: oiStr, chgCls: '' };
  const chg = oi - prev;
  const pct = Math.round((chg / prev) * 100);
  const sign = chg > 0 ? '+' : '';
  return {
    text: `${oiStr} (${sign}${pct}%)`,
    chgCls: chg > 0 ? 'oi-history__cell--up' : chg < 0 ? 'oi-history__cell--down' : '',
  };
}

/** Get current month in YYYY-MM (IST) */
function currentMonthIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Build month options: current month + 2 previous months */
function buildMonthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(ist.getFullYear(), ist.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    options.push({ value: val, label });
  }
  return options;
}

/** Get first and last day of a month as YYYY-MM-DD */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

/** Classify rollover pattern for a strike+optionType across expiries */
function classifyPattern(
  oiByExpiry: Map<string, { oi: number; prevOi: number | undefined }>,
  expiries: string[],
): RolloverPattern {
  if (expiries.length < 2) return '-';

  // Find the nearest expiry with data
  let nearestIdx = -1;
  for (let i = 0; i < expiries.length; i++) {
    if (oiByExpiry.has(expiries[i])) { nearestIdx = i; break; }
  }
  if (nearestIdx < 0) return '-';

  const nearest = oiByExpiry.get(expiries[nearestIdx])!;
  const nearestChg = nearest.prevOi !== undefined && nearest.prevOi > 0
    ? (nearest.oi - nearest.prevOi) / nearest.prevOi
    : 0;

  // Check further expiries
  let anyRising = false;
  let anyFalling = false;
  let farCount = 0;

  for (let i = nearestIdx + 1; i < expiries.length; i++) {
    const entry = oiByExpiry.get(expiries[i]);
    if (!entry || entry.oi === 0) continue;
    farCount++;
    const chg = entry.prevOi !== undefined && entry.prevOi > 0
      ? (entry.oi - entry.prevOi) / entry.prevOi
      : (entry.oi > 0 ? 1 : 0); // new position = rising
    if (chg > 0.02) anyRising = true;
    if (chg < -0.02) anyFalling = true;
  }

  const nearFalling = nearestChg < -0.02;
  const nearRising = nearestChg > 0.02;

  // No data on further expiries
  if (farCount === 0) {
    if (nearFalling) return 'Exiting';
    if (nearRising) return 'Fresh Build';
    return 'Stable';
  }

  // Classification logic
  if (nearFalling && anyRising) return 'Rolling Over';
  if (nearFalling && !anyRising && anyFalling) return 'Unwinding';
  if (nearFalling && !anyRising) return 'Exiting';
  if (nearRising && anyRising) return 'Doubling Down';
  if (!nearFalling && !nearRising && anyRising) return 'Fresh Build';
  if (!nearFalling && !nearRising && anyFalling) return 'Unwinding';
  return 'Stable';
}

/** Color for pattern label */
function patternColor(p: RolloverPattern): string {
  switch (p) {
    case 'Rolling Over': return 'var(--accent)';
    case 'Exiting': return '#ef4444';
    case 'Fresh Build': return '#22c55e';
    case 'Doubling Down': return '#22c55e';
    case 'Unwinding': return '#ef4444';
    case 'Stable': return 'var(--text-secondary)';
    default: return 'var(--text-secondary)';
  }
}

/** Short expiry label: '2026-07-07' → 'Jul 7' with (W) or (M) suffix */
function expiryLabel(expiry: string, isMonthly: boolean): string {
  const d = new Date(expiry + 'T00:00:00');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  return `${month} ${day}${isMonthly ? ' (M)' : ''}`;
}

/** Check if an expiry is monthly (last Thursday of month — approximate: last 7 days) */
function isMonthlyExpiry(expiry: string): boolean {
  const d = new Date(expiry + 'T00:00:00');
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() > lastDay - 7;
}

const OiHistory: React.FC = () => {
  const [scrip, setScrip] = useState('NIFTY50');
  const [selectedMonth, setSelectedMonth] = useState(currentMonthIST());
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [showPatternInfo, setShowPatternInfo] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  /** Load stored data from server */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = monthRange(selectedMonth);
      const params = new URLSearchParams({ scrip, from, to });
      const res = await fetch(`/api/oi-history?${params}`, { credentials: 'include' });
      const json = await res.json();
      if (json.status === 'ok') {
        setData(json.data);
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
  }, [scrip, selectedMonth]);

  /** Fetch historical OI from Kite via SSE stream */
  const handleFetch = useCallback(async () => {
    setFetching(true);
    setProgress({ step: 'Connecting...', pct: 0, detail: '' });
    setFetchResult(null);
    setFetchError(null);

    try {
      const { from, to } = monthRange(selectedMonth);
      const res = await fetch('/api/oi-history/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          scrip,
          from,
          to,
          targetMonth: selectedMonth,
        }),
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
                    step: 'Fetching OI data...',
                    pct: payload.pct,
                    detail: `${payload.done}/${payload.total} instruments (batch ${payload.batch}/${payload.totalBatches})`,
                  });
                  break;
                case 'done': {
                  const parts: string[] = [];
                  if (payload.message) {
                    parts.push(payload.message);
                  } else {
                    if (payload.fetchedDays > 0)
                      parts.push(`Fetched ${formatNum(payload.rowCount)} rows for ${payload.fetchedDays} new days`);
                    if (payload.skippedDays > 0)
                      parts.push(`${payload.skippedDays} days already cached`);
                    if (payload.uniqueTokens > 0)
                      parts.push(`${payload.uniqueTokens} instruments`);
                    if (parts.length === 0)
                      parts.push('All data already cached');
                  }
                  setFetchResult(parts.join(' \u00b7 '));
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
      loadData();
    }
  }, [scrip, selectedMonth, loadData]);

  /** Unique dates in the loaded data */
  const availableDates = useMemo(() => {
    return [...new Set(data.map((r) => r.date))].sort();
  }, [data]);

  /** Unique expiries in the loaded data for the selected month, sorted */
  const expiries = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      if (r.expiry) set.add(r.expiry);
    }
    return [...set].sort();
  }, [data]);

  /** Rows for the selected date */
  const filteredRows = useMemo(() => {
    if (!filterDate) return [];
    return data.filter((r) => r.date === filterDate);
  }, [data, filterDate]);

  /** Rows for the previous date (for OI change computation) */
  const prevDateRows = useMemo(() => {
    if (!filterDate || availableDates.length < 2) return [];
    const idx = availableDates.indexOf(filterDate);
    if (idx <= 0) return [];
    const prevDate = availableDates[idx - 1];
    return data.filter((r) => r.date === prevDate);
  }, [data, filterDate, availableDates]);

  /** Map: instrumentToken → previous day OI */
  const prevDayOi = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of prevDateRows) {
      map.set(r.instrumentToken, r.oi);
    }
    return map;
  }, [prevDateRows]);

  /** ATM strike for the selected date */
  const atmStrike = useMemo(() => {
    if (filteredRows.length === 0) return null;
    const spot = filteredRows[0].spotClose;
    return Math.round(spot / 50) * 50;
  }, [filteredRows]);

  /** Build table data: rows = strikes, columns = expiries */
  const tableData = useMemo(() => {
    if (filteredRows.length === 0 || expiries.length === 0) return [];

    // Index: strike → expiry → { ce, pe }
    type CellData = {
      ceOi: number;
      peOi: number;
      cePrevOi: number | undefined;
      pePrevOi: number | undefined;
      ceToken: number | undefined;
      peToken: number | undefined;
    };

    const grid = new Map<number, Map<string, CellData>>();

    for (const r of filteredRows) {
      if (!r.strike || !r.optionType || !r.expiry) continue;

      if (!grid.has(r.strike)) grid.set(r.strike, new Map());
      const strikeMap = grid.get(r.strike)!;

      if (!strikeMap.has(r.expiry)) {
        strikeMap.set(r.expiry, {
          ceOi: 0, peOi: 0,
          cePrevOi: undefined, pePrevOi: undefined,
          ceToken: undefined, peToken: undefined,
        });
      }
      const cell = strikeMap.get(r.expiry)!;

      if (r.optionType === 'CE') {
        cell.ceOi = r.oi;
        cell.ceToken = r.instrumentToken;
        cell.cePrevOi = prevDayOi.get(r.instrumentToken);
      } else {
        cell.peOi = r.oi;
        cell.peToken = r.instrumentToken;
        cell.pePrevOi = prevDayOi.get(r.instrumentToken);
      }
    }

    // Build rows sorted by strike
    const rows = [...grid.entries()]
      .sort(([a], [b]) => a - b)
      .map(([strike, expiryMap]) => {
        // Filter: only show strikes with >100K OI on any expiry
        let hasSignificantOi = false;
        for (const cell of expiryMap.values()) {
          if (cell.ceOi > 100_000 || cell.peOi > 100_000) {
            hasSignificantOi = true;
            break;
          }
        }
        if (!hasSignificantOi) return null;

        // Classify CE and PE patterns
        const ceByExpiry = new Map<string, { oi: number; prevOi: number | undefined }>();
        const peByExpiry = new Map<string, { oi: number; prevOi: number | undefined }>();
        for (const [exp, cell] of expiryMap) {
          if (cell.ceOi > 0) ceByExpiry.set(exp, { oi: cell.ceOi, prevOi: cell.cePrevOi });
          if (cell.peOi > 0) peByExpiry.set(exp, { oi: cell.peOi, prevOi: cell.pePrevOi });
        }

        const cePattern = classifyPattern(ceByExpiry, expiries);
        const pePattern = classifyPattern(peByExpiry, expiries);

        return {
          strike,
          cells: expiryMap,
          cePattern,
          pePattern,
        };
      })
      .filter(Boolean) as {
        strike: number;
        cells: Map<string, {
          ceOi: number; peOi: number;
          cePrevOi: number | undefined; pePrevOi: number | undefined;
          ceToken: number | undefined; peToken: number | undefined;
        }>;
        cePattern: RolloverPattern;
        pePattern: RolloverPattern;
      }[];

    return rows;
  }, [filteredRows, expiries, prevDayOi]);

  return (
    <div className="oi-history">
      {/* Controls */}
      <div className="oi-history__controls card">
        <div className="oi-history__control-row">
          <label className="oi-history__label">
            Script
            <AppSelect
              value={scrip}
              options={SCRIP_OPTIONS}
              onChange={(v) => setScrip(String(v))}
            />
          </label>

          <label className="oi-history__label">
            Month
            <AppSelect
              value={selectedMonth}
              options={monthOptions}
              onChange={(v) => setSelectedMonth(String(v))}
            />
          </label>

          <button
            className="app-btn app-btn--primary"
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
              {d.slice(5)}
            </button>
          ))}
        </div>
      )}

      {/* Expiry-pivoted table */}
      {tableData.length > 0 && (
        <div className="oi-history__table-wrap card">
          <div className="oi-history__table-header">
            <div className="oi-history__table-header-left">
              <span className="oi-history__table-title">
                {filterDate} &mdash; Spot: {formatNum(filteredRows[0]?.spotClose || 0)}
              </span>
              <button className="trap-info-btn" onClick={() => setShowPatternInfo(!showPatternInfo)} title="Pattern definitions">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
            <span className="oi-history__table-count">
              {tableData.length} strikes &middot; {expiries.length} expiries
            </span>
          </div>

          {showPatternInfo && (
            <div className="trap-info-detail" style={{ marginBottom: 12 }}>
              <h4>Rollover Pattern Definitions</h4>
              <p>Patterns classify how OI is moving across expiries for each strike and option type (CE/PE separately).</p>
              <ul>
                <li><strong style={{ color: 'var(--accent)' }}>Rolling Over</strong> — Nearest expiry OI falling while a further expiry OI is rising. Institutions are maintaining their position at this strike by moving to the next expiry. Strong signal that this level matters.</li>
                <li><strong style={{ color: '#ef4444' }}>Exiting</strong> — Nearest expiry OI falling with no buildup on any other expiry. Institutions are closing out — the wall or support at this strike is weakening.</li>
                <li><strong style={{ color: '#22c55e' }}>Fresh Build</strong> — OI building on a further expiry where little or none existed before. New institutional bet — watch this strike for emerging support/resistance.</li>
                <li><strong style={{ color: '#22c55e' }}>Doubling Down</strong> — OI rising on both nearest and further expiries. Strong conviction — institutions are adding at this level across multiple timeframes.</li>
                <li><strong style={{ color: '#ef4444' }}>Unwinding</strong> — OI falling across all expiries at this strike. Full retreat — the level is no longer being defended.</li>
                <li><strong style={{ color: 'var(--text-secondary)' }}>Stable</strong> — No significant change (&lt;2%) across expiries. Positions are being held, neither added nor removed.</li>
              </ul>
              <h5>How to Use</h5>
              <ul>
                <li><strong>CE Rolling Over</strong> at 24500 = call writers maintaining resistance at 24500 (bearish cap)</li>
                <li><strong>PE Rolling Over</strong> at 24000 = put writers maintaining support at 24000 (bullish floor)</li>
                <li><strong>PE Exiting</strong> at 24000 = support at 24000 is weakening — potential breakdown</li>
                <li><strong>CE Exiting</strong> at 24500 = resistance at 24500 is weakening — potential breakout</li>
              </ul>
              <p>OI change (Chg) is vs the previous trading day. Use the date navigation to track how patterns evolve over time.</p>
            </div>
          )}

          <div className="oi-history__table-scroll">
            <table className="oi-history__table">
              <thead>
                <tr>
                  <th className="oi-history__th-pattern">CE Pattern</th>
                  {expiries.map((exp) => (
                    <th key={`ce-${exp}`} className="oi-history__th-group oi-history__th-group--ce">
                      {expiryLabel(exp, isMonthlyExpiry(exp))}
                    </th>
                  ))}
                  <th className="oi-history__th-strike">Strike</th>
                  {expiries.map((exp) => (
                    <th key={`pe-${exp}`} className="oi-history__th-group oi-history__th-group--pe">
                      {expiryLabel(exp, isMonthlyExpiry(exp))}
                    </th>
                  ))}
                  <th className="oi-history__th-pattern">PE Pattern</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map(({ strike, cells, cePattern, pePattern }) => {
                  const isAtm = strike === atmStrike;
                  return (
                    <tr
                      key={strike}
                      className={`${isAtm ? 'oi-history__row--atm' : ''} ${selectedStrike === strike ? 'oi-history__row--selected' : ''}`}
                      onClick={() => setSelectedStrike(selectedStrike === strike ? null : strike)}
                    >
                      {/* CE Pattern */}
                      <td
                        className="oi-history__cell--pattern"
                        style={{ color: patternColor(cePattern) }}
                      >
                        {cePattern}
                      </td>

                      {/* CE data per expiry */}
                      {expiries.map((exp) => {
                        const cell = cells.get(exp);
                        const { text, chgCls } = formatOiWithChg(cell?.ceOi || 0, cell?.cePrevOi);
                        return (
                          <td key={`ce-${exp}`} className={`oi-history__cell--ce ${chgCls}`}>
                            {text}
                          </td>
                        );
                      })}

                      {/* Strike */}
                      <td className={`oi-history__cell--strike ${isAtm ? 'oi-history__cell--strike-atm' : ''}`}>
                        {strike}
                      </td>

                      {/* PE data per expiry */}
                      {expiries.map((exp) => {
                        const cell = cells.get(exp);
                        const { text, chgCls } = formatOiWithChg(cell?.peOi || 0, cell?.pePrevOi);
                        return (
                          <td key={`pe-${exp}`} className={`oi-history__cell--pe ${chgCls}`}>
                            {text}
                          </td>
                        );
                      })}

                      {/* PE Pattern */}
                      <td
                        className="oi-history__cell--pattern"
                        style={{ color: patternColor(pePattern) }}
                      >
                        {pePattern}
                      </td>
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
          Select a month and click <strong>Fetch</strong> to download multi-expiry OI data.
          Already-fetched days are skipped automatically.
        </div>
      )}
    </div>
  );
};

export default OiHistory;
