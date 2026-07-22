import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { addPosition } from '@/services/positions';
import { getLotSize } from '@/services/optionChain';
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
  | 'Rolling Over (Long)'
  | 'Rolling Over (Short)'
  | 'Rolling Over'
  | 'Exiting (Long Unwind)'
  | 'Exiting (Short Cover)'
  | 'Exiting'
  | 'Fresh Build (Long)'
  | 'Fresh Build (Short)'
  | 'Fresh Build'
  | 'Doubling Down (Long)'
  | 'Doubling Down (Short)'
  | 'Doubling Down'
  | 'Long Buildup'
  | 'Short Buildup'
  | 'Long Unwinding'
  | 'Short Covering'
  | 'Unwinding'
  | 'Stable'
  | '-';

/** Default scrip options shown before dynamic list loads */
const DEFAULT_SCRIP_OPTIONS = [
  { value: 'NIFTY50', label: 'NIFTY 50' },
  { value: 'BANKNIFTY', label: 'BANK NIFTY' },
];

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

/** Format a month string (YYYY-MM) to label (e.g., "July 2026") */
function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Get first and last day of a month as YYYY-MM-DD */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

/** Determine price direction: 'up' if price rose, 'down' if fell, null if unknown */
function priceDirection(
  data: Map<string, { close: number; prevClose: number | undefined }>,
  expiries: string[],
): 'up' | 'down' | null {
  // Use weighted average price change across expiries with data
  let totalChg = 0;
  let count = 0;
  for (const exp of expiries) {
    const entry = data.get(exp);
    if (!entry || !entry.prevClose || entry.prevClose === 0) continue;
    totalChg += (entry.close - entry.prevClose) / entry.prevClose;
    count++;
  }
  if (count === 0) return null;
  const avgChg = totalChg / count;
  if (avgChg > 0.005) return 'up';   // >0.5% rise
  if (avgChg < -0.005) return 'down'; // >0.5% fall
  return null;
}

/** Classify rollover pattern for a strike+optionType across expiries */
function classifyPattern(
  oiByExpiry: Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>,
  expiries: string[],
): RolloverPattern {
  // Single expiry (monthly scrips like BANKNIFTY): use OI + Price signal
  if (expiries.length < 2) {
    // Find the expiry with data
    let entry: { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined } | undefined;
    for (const exp of expiries) {
      if (oiByExpiry.has(exp)) { entry = oiByExpiry.get(exp); break; }
    }
    if (!entry || entry.prevOi === undefined || entry.prevOi === 0) return '-';

    const oiChg = (entry.oi - entry.prevOi) / entry.prevOi;
    const priceChg = entry.prevClose !== undefined && entry.prevClose > 0
      ? (entry.close - entry.prevClose) / entry.prevClose
      : 0;

    const oiRising = oiChg > 0.02;
    const oiFalling = oiChg < -0.02;
    const priceUp = priceChg > 0.005;
    const priceDown = priceChg < -0.005;

    if (oiRising && priceUp) return 'Long Buildup';
    if (oiRising && priceDown) return 'Short Buildup';
    if (oiFalling && priceDown) return 'Long Unwinding';
    if (oiFalling && priceUp) return 'Short Covering';
    return 'Stable';
  }

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

  // Get price direction for context
  const pDir = priceDirection(oiByExpiry, expiries);
  const longSuffix = pDir === 'up' ? ' (Long)' : pDir === 'down' ? ' (Short)' : '';
  const exitSuffix = pDir === 'down' ? ' (Long Unwind)' : pDir === 'up' ? ' (Short Cover)' : '';

  // No data on further expiries
  if (farCount === 0) {
    if (nearFalling) return `Exiting${exitSuffix}` as RolloverPattern;
    if (nearRising) return `Fresh Build${longSuffix}` as RolloverPattern;
    return 'Stable';
  }

  // Classification logic
  if (nearFalling && anyRising) return `Rolling Over${longSuffix}` as RolloverPattern;
  if (nearFalling && !anyRising && anyFalling) return 'Unwinding';
  if (nearFalling && !anyRising) return `Exiting${exitSuffix}` as RolloverPattern;
  if (nearRising && anyRising) return `Doubling Down${longSuffix}` as RolloverPattern;
  if (!nearFalling && !nearRising && anyRising) return `Fresh Build${longSuffix}` as RolloverPattern;
  if (!nearFalling && !nearRising && anyFalling) return 'Unwinding';
  return 'Stable';
}

/** Color for pattern label */
function patternColor(p: RolloverPattern): string {
  if (p.startsWith('Rolling Over')) return 'var(--accent)';
  if (p.startsWith('Exiting')) return '#ef4444';
  if (p.startsWith('Fresh Build')) return '#22c55e';
  if (p.startsWith('Doubling Down')) return '#22c55e';
  if (p === 'Long Buildup') return '#22c55e';
  if (p === 'Short Buildup') return '#ef4444';
  if (p === 'Long Unwinding') return '#ef4444';
  if (p === 'Short Covering') return '#22c55e';
  if (p === 'Unwinding') return '#ef4444';
  if (p === 'Stable') return 'var(--text-secondary)';
  return 'var(--text-secondary)';
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
  const lastFetchedRef = useRef('');
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [showPatternInfo, setShowPatternInfo] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [scripOptions, setScripOptions] = useState(DEFAULT_SCRIP_OPTIONS);
  const [monthOptions, setMonthOptions] = useState<{ value: string; label: string }[]>(() => {
    const current = currentMonthIST();
    return [{ value: current, label: formatMonthLabel(current) }];
  });
  const [strikeRange, setStrikeRange] = useState<number>(() => {
    const stored = localStorage.getItem('optiontrap_strike_range');
    return stored ? parseInt(stored, 10) : 10;
  });

  // Fetch available months for the selected scrip from DB
  useEffect(() => {
    const current = currentMonthIST();
    fetch(`/api/oi-history/months?scrip=${scrip}`, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (json.status === 'ok') {
          const months: string[] = json.months || [];
          // Ensure current month is always included
          if (!months.includes(current)) {
            months.unshift(current);
          }
          setMonthOptions(months.map((m) => ({ value: m, label: formatMonthLabel(m) })));
        }
      })
      .catch(() => {
        // Fallback to just current month
        setMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
      });
  }, [scrip]);

  // Fetch available F&O symbols on mount
  useEffect(() => {
    fetch('/api/fno-symbols', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (json.status === 'ok' && json.data?.length > 0) {
          const options = json.data.map((name: string) => ({
            value: name === 'NIFTY' ? 'NIFTY50' : name,
            label: name === 'NIFTY' ? 'NIFTY 50' : name === 'BANKNIFTY' ? 'BANK NIFTY' : name,
          }));
          setScripOptions(options);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

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
                  setProgress((prev) => {
                    // Only move forward — prevent flickering from interleaved events
                    if (prev && payload.pct < prev.pct) return prev;
                    return {
                      step: 'Fetching OI data...',
                      pct: payload.pct,
                      detail: `${payload.done}/${payload.total} instruments (batch ${payload.batch}/${payload.totalBatches})`,
                    };
                  });
                  break;
                case 'done': {
                  const parts: string[] = [];
                  if (payload.message) {
                    parts.push(payload.message);
                  } else {
                    if (payload.fetchedDays > 0)
                      parts.push(`Fetched ${formatNum(payload.rowCount)} rows for ${payload.fetchedDays} new days`);
                    if (payload.uniqueTokens > 0)
                      parts.push(`${payload.uniqueTokens} instruments`);
                  }
                  if (parts.length > 0) setFetchResult(null);
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

  // When scrip or month changes, load existing data from the DB only.
  // Fetching fresh data from Kite is an explicit action via the Fetch button.
  useEffect(() => {
    const key = `${scrip}_${selectedMonth}`;
    if (lastFetchedRef.current === key) return;
    lastFetchedRef.current = key;

    // Clear old data immediately so stale content isn't shown
    setData([]);
    setSelectedStrike(null);
    setFilterDate('');
    setFetchResult(null);
    setFetchError(null);

    loadData();
  }, [scrip, selectedMonth, loadData]);

  /** Delete all OI history for the selected month (all scrips) */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteMonth = useCallback(async () => {
    setConfirmDelete(false);

    try {
      const res = await fetch(`/api/oi-history?month=${selectedMonth}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.status === 'ok') {
        setData([]);
        lastFetchedRef.current = '';
        setSelectedStrike(null);
        setFilterDate('');
      } else {
        setFetchError(json.message || 'Failed to delete');
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    }
  }, [selectedMonth]);

  // Toast notifications for trade feedback
  const [toasts, setToasts] = useState<{ id: number; text: string; color: 'green' | 'red' }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((text: string, color: 'green' | 'red') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  // Handle buy/sell from OI history cells
  const handleTrade = useCallback(async (
    cell: any,
    optionType: 'CE' | 'PE',
    side: 'BUY' | 'SELL',
    strike: number,
    expiry: string,
  ) => {
    const token = optionType === 'CE' ? cell.ceToken : cell.peToken;
    const tradingsymbol = optionType === 'CE' ? cell.ceTradingsymbol : cell.peTradingsymbol;
    const price = optionType === 'CE' ? cell.ceClose : cell.peClose;

    if (!token || !tradingsymbol || !price) return;

    try {
      await addPosition({
        tradingsymbol,
        instrumentToken: token,
        strike,
        optionType,
        side,
        quantity: getLotSize(token),
        entryPrice: price,
        expiry,
      });
      showToast(`${side} ${strike}${optionType} @ ₹${price.toFixed(2)}`, 'green');
    } catch {
      showToast('Failed to add position', 'red');
    }
  }, [showToast]);

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

  const prevDayClose = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of prevDateRows) {
      if (r.close > 0) map.set(r.instrumentToken, r.close);
    }
    return map;
  }, [prevDateRows]);

  /** ATM strike for the selected date */
  const atmStrike = useMemo(() => {
    if (filteredRows.length === 0) return null;
    const spot = filteredRows[0].spotClose;
    // Find the closest strike to spot price from the actual data
    const strikes = [...new Set(filteredRows.filter((r) => r.strike).map((r) => r.strike as number))].sort((a, b) => a - b);
    if (strikes.length === 0) return null;
    let closest = strikes[0];
    let minDiff = Math.abs(strikes[0] - spot);
    for (const s of strikes) {
      const diff = Math.abs(s - spot);
      if (diff < minDiff) { minDiff = diff; closest = s; }
    }
    return closest;
  }, [filteredRows]);

  const selectedSpotClose = filteredRows[0]?.spotClose ?? null;

  // Auto-select ATM strike to show chart on load
  useEffect(() => {
    if (atmStrike) {
      setSelectedStrike(atmStrike);
    }
  }, [atmStrike]);

  /** Build table data: rows = strikes, columns = expiries */
  const tableData = useMemo(() => {
    if (filteredRows.length === 0 || expiries.length === 0) return [];

    // Index: strike → expiry → { ce, pe }
    type CellData = {
      ceOi: number;
      peOi: number;
      cePrevOi: number | undefined;
      pePrevOi: number | undefined;
      ceClose: number;
      peClose: number;
      cePrevClose: number | undefined;
      pePrevClose: number | undefined;
      ceToken: number | undefined;
      peToken: number | undefined;
      ceTradingsymbol: string | undefined;
      peTradingsymbol: string | undefined;
      ceExpiry: string | undefined;
      peExpiry: string | undefined;
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
          ceClose: 0, peClose: 0,
          cePrevClose: undefined, pePrevClose: undefined,
          ceToken: undefined, peToken: undefined,
          ceTradingsymbol: undefined, peTradingsymbol: undefined,
          ceExpiry: undefined, peExpiry: undefined,
        });
      }
      const cell = strikeMap.get(r.expiry)!;

      if (r.optionType === 'CE') {
        cell.ceOi = r.oi;
        cell.ceClose = r.close;
        cell.ceToken = r.instrumentToken;
        cell.ceTradingsymbol = r.tradingsymbol;
        cell.ceExpiry = r.expiry;
        cell.cePrevOi = prevDayOi.get(r.instrumentToken);
        cell.cePrevClose = prevDayClose.get(r.instrumentToken);
      } else {
        cell.peOi = r.oi;
        cell.peClose = r.close;
        cell.peToken = r.instrumentToken;
        cell.peTradingsymbol = r.tradingsymbol;
        cell.peExpiry = r.expiry;
        cell.pePrevOi = prevDayOi.get(r.instrumentToken);
        cell.pePrevClose = prevDayClose.get(r.instrumentToken);
      }
    }

    // Compute dynamic OI threshold: show strikes with OI > 10% of the max OI in the dataset
    // This adapts to any scrip (indices have millions, stocks have thousands)
    let maxOiInGrid = 0;
    for (const expiryMap of grid.values()) {
      for (const cell of expiryMap.values()) {
        if (cell.ceOi > maxOiInGrid) maxOiInGrid = cell.ceOi;
        if (cell.peOi > maxOiInGrid) maxOiInGrid = cell.peOi;
      }
    }
    const oiThreshold = Math.max(1000, maxOiInGrid * 0.05);

    // Build rows sorted by strike
    const rows = [...grid.entries()]
      .sort(([a], [b]) => a - b)
      .map(([strike, expiryMap]) => {
        // Check if strike has significant OI (above 5% of max)
        let hasSignificantOi = false;
        for (const cell of expiryMap.values()) {
          if (cell.ceOi > oiThreshold || cell.peOi > oiThreshold) {
            hasSignificantOi = true;
            break;
          }
        }

        // Classify CE and PE patterns
        const ceByExpiry = new Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>();
        const peByExpiry = new Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>();
        for (const [exp, cell] of expiryMap) {
          if (cell.ceOi > 0) ceByExpiry.set(exp, { oi: cell.ceOi, prevOi: cell.cePrevOi, close: cell.ceClose, prevClose: cell.cePrevClose });
          if (cell.peOi > 0) peByExpiry.set(exp, { oi: cell.peOi, prevOi: cell.pePrevOi, close: cell.peClose, prevClose: cell.pePrevClose });
        }

        const cePattern = classifyPattern(ceByExpiry, expiries);
        const pePattern = classifyPattern(peByExpiry, expiries);

        return {
          strike,
          cells: expiryMap,
          cePattern,
          pePattern,
          dimmed: !hasSignificantOi,
        };
      }) as {
        strike: number;
        cells: Map<string, CellData>;
        cePattern: RolloverPattern;
        pePattern: RolloverPattern;
        dimmed: boolean;
      }[];

    // Limit strikes around ATM based on selected range
    if (strikeRange > 0 && atmStrike && rows.length > 0) {
      const atmIdx = rows.findIndex((r) => r.strike >= atmStrike);
      const center = atmIdx >= 0 ? atmIdx : Math.floor(rows.length / 2);
      const start = Math.max(0, center - strikeRange);
      const end = Math.min(rows.length, center + strikeRange + 1);
      return rows.slice(start, end);
    }

    return rows;
  }, [filteredRows, expiries, prevDayOi, prevDayClose, scrip, atmStrike, strikeRange]);

  /** Chart data for selected strike across all dates */
  const chartData = useMemo(() => {
    if (!selectedStrike || availableDates.length === 0) return null;

    // Group data by date+expiry for the selected strike
    const dateMap = new Map<string, Map<string, { ceOi: number; peOi: number; ceClose: number; peClose: number }>>();

    for (const r of data) {
      if (r.strike !== selectedStrike || !r.expiry) continue;
      if (!dateMap.has(r.date)) dateMap.set(r.date, new Map());
      const expMap = dateMap.get(r.date)!;
      if (!expMap.has(r.expiry)) expMap.set(r.expiry, { ceOi: 0, peOi: 0, ceClose: 0, peClose: 0 });
      const entry = expMap.get(r.expiry)!;
      if (r.optionType === 'CE') {
        entry.ceOi = r.oi;
        entry.ceClose = r.close;
      } else {
        entry.peOi = r.oi;
        entry.peClose = r.close;
      }
    }

    const dates = availableDates.filter((d) => dateMap.has(d));
    if (dates.length === 0) return null;

    // Find max values for axis scaling
    let maxOi = 0;
    let maxCePrice = 0;
    let maxPePrice = 0;
    for (const [, expMap] of dateMap) {
      for (const [, v] of expMap) {
        if (v.ceOi > maxOi) maxOi = v.ceOi;
        if (v.peOi > maxOi) maxOi = v.peOi;
        if (v.ceClose > maxCePrice) maxCePrice = v.ceClose;
        if (v.peClose > maxPePrice) maxPePrice = v.peClose;
      }
    }

    return { dates, dateMap, maxOi, maxCePrice, maxPePrice };
  }, [data, selectedStrike, availableDates]);

  /** Expiry colors for chart lines */
  const expiryColors = useMemo(() => {
    const palette = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'];
    const map = new Map<string, string>();
    expiries.forEach((exp, i) => map.set(exp, palette[i % palette.length]));
    return map;
  }, [expiries]);

  return (
    <div className="oi-history">
      {toasts.length > 0 && (
        <div className="oi-history__toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`oi-history__toast oi-history__toast--${t.color}`}>{t.text}</div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="oi-history__controls card">
        <div className="oi-history__control-row">
          <label className="oi-history__label">
            <AppSelect
              value={scrip}
              options={scripOptions}
              onChange={(v) => setScrip(String(v))}
              searchable
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            <AppSelect
              value={selectedMonth}
              options={monthOptions}
              onChange={(v) => setSelectedMonth(String(v))}
              disabled={fetching}
            />
          </label>

          <AppSelect
            value={strikeRange}
            options={[
              { value: 5, label: '5' },
              { value: 10, label: '10' },
              { value: 20, label: '20' },
              { value: 0, label: 'All' },
            ]}
            onChange={(v) => { const val = Number(v); setStrikeRange(val); localStorage.setItem('optiontrap_strike_range', String(val)); }}
          />

          <button
            className="app-btn app-btn--primary"
            onClick={handleFetch}
            disabled={fetching}
            title={`Fetch ${scrip} data for ${selectedMonth} from Kite`}
          >
            {fetching ? 'Fetching…' : 'Fetch'}
          </button>

          <button
            className="app-btn app-btn--danger app-btn--icon"
            onClick={() => setConfirmDelete(true)}
            disabled={fetching}
            title={`Delete all data for ${selectedMonth}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>

          <button
            className="app-btn app-btn--icon"
            onClick={() => setShowPatternInfo(!showPatternInfo)}
            title="Pattern definitions"
            style={{ marginLeft: 'auto' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
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

        {showPatternInfo && (
          <div className="trap-info-detail" style={{ marginTop: 12 }}>
            <h4>Pattern Definitions</h4>
            <p>Patterns classify <strong>who</strong> is active at each strike based on day-over-day OI change and option price movement.</p>

            <h5>OI + Price Signals (single expiry / monthly scrips)</h5>
            <ul>
              <li><strong style={{ color: '#22c55e' }}>Long Buildup</strong> — OI ↑ + Price ↑ — New buyers entering aggressively. Bullish for the option.</li>
              <li><strong style={{ color: '#ef4444' }}>Short Buildup</strong> — OI ↑ + Price ↓ — New sellers entering aggressively. Bearish for the option.</li>
              <li><strong style={{ color: '#ef4444' }}>Long Unwinding</strong> — OI ↓ + Price ↓ — Buyers exiting, giving up. Weakness in that direction.</li>
              <li><strong style={{ color: '#22c55e' }}>Short Covering</strong> — OI ↓ + Price ↑ — Sellers exiting, bears retreating. Bullish reversal signal.</li>
            </ul>

            <h5>Rollover Patterns (multiple expiries / weekly scrips)</h5>
            <ul>
              <li><strong style={{ color: 'var(--accent)' }}>Rolling Over (Short)</strong> — Writers moving positions to next expiry. Strike is being actively defended.</li>
              <li><strong style={{ color: 'var(--accent)' }}>Rolling Over (Long)</strong> — Buyers moving to next expiry. Directional conviction maintained.</li>
              <li><strong style={{ color: '#ef4444' }}>Exiting (Long Unwind)</strong> — Buyers closing out, no new positions. Support/resistance weakening.</li>
              <li><strong style={{ color: '#ef4444' }}>Exiting (Short Cover)</strong> — Sellers closing out, the wall is being abandoned.</li>
              <li><strong style={{ color: '#22c55e' }}>Fresh Build (Short)</strong> — New sellers at far expiry. New wall being established.</li>
              <li><strong style={{ color: '#22c55e' }}>Fresh Build (Long)</strong> — New buyers at far expiry. New directional bet.</li>
              <li><strong style={{ color: '#22c55e' }}>Doubling Down</strong> — OI rising across multiple expiries. Strong conviction.</li>
              <li><strong style={{ color: '#ef4444' }}>Unwinding</strong> — OI falling across all expiries. Full retreat from this level.</li>
              <li><strong style={{ color: 'var(--text-secondary)' }}>Stable</strong> — No significant change (&lt;2%). Positions held steady.</li>
            </ul>

            <h5>How to Read</h5>
            <ul>
              <li><strong>CE Short Buildup</strong> at 1800 = call sellers adding positions, expecting price won't cross 1800. Resistance forming.</li>
              <li><strong>PE Long Buildup</strong> at 1700 = put buyers entering, expecting price to fall below 1700. Bearish bet.</li>
              <li><strong>PE Short Covering</strong> at 1700 = put sellers exiting, support at 1700 weakening.</li>
              <li><strong>CE Long Unwinding</strong> at 1800 = call buyers giving up on 1800 breakout.</li>
            </ul>
            <p>Dimmed rows have OI below 5% of the max — less significant strikes. Click any row to see its OI &amp; price chart across dates.</p>
          </div>
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
              {d.slice(8)}
            </button>
          ))}
        </div>
      )}

      {/* Loading indicator */}
      {(loading || fetching) && data.length === 0 && (
        <div className="card oi-history__loading-card">
          <div className="oi-history__loading-spinner" />
          <span className="oi-history__loading-text">Loading data...</span>
        </div>
      )}

      {/* Expiry-pivoted table */}
      {tableData.length > 0 && (
        <div className="oi-history__table-wrap card">
          <div className="oi-history__table-header">
            <div className="oi-history__table-count">
              {tableData.length} strikes &middot; {expiries.length} expiries
            </div>
          </div>

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
                {tableData.map(({ strike, cells, cePattern, pePattern, dimmed }) => {
                  const isAtm = strike === atmStrike;
                  const isCeItm = selectedSpotClose !== null && selectedSpotClose > 0 && strike < selectedSpotClose;
                  const isPeItm = selectedSpotClose !== null && selectedSpotClose > 0 && strike > selectedSpotClose;
                  return (
                    <tr
                      key={strike}
                      className={`${isAtm ? 'oi-history__row--atm' : ''} ${selectedStrike === strike ? 'oi-history__row--selected' : ''} ${dimmed ? 'oi-history__row--dimmed' : ''}`}
                      onClick={() => setSelectedStrike(strike)}
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
                        const closePrice = cell?.ceClose || 0;
                        return (
                          <td key={`ce-${exp}`} className={`oi-history__cell--ce oi-history__cell--tradeable ${isCeItm ? 'oi-history__cell--itm-ce' : ''} ${chgCls}`}>
                            <div className="oi-history__cell-content">
                              <span className="oi-history__cell-primary">{text}</span>
                              {closePrice > 0 && <span className="oi-history__cell-price">₹{closePrice.toFixed(closePrice < 10 ? 2 : closePrice < 100 ? 1 : 0)}</span>}
                            </div>
                            {cell?.ceToken && closePrice > 0 && (
                              <div className="oi-history__cell-actions">
                                <button className="oi-history__action-btn oi-history__action-btn--buy" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'CE', 'BUY', strike, exp); }}>B</button>
                                <button className="oi-history__action-btn oi-history__action-btn--sell" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'CE', 'SELL', strike, exp); }}>S</button>
                              </div>
                            )}
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
                        const closePrice = cell?.peClose || 0;
                        return (
                          <td key={`pe-${exp}`} className={`oi-history__cell--pe oi-history__cell--tradeable ${isPeItm ? 'oi-history__cell--itm-pe' : ''} ${chgCls}`}>
                            <div className="oi-history__cell-content">
                              <span className="oi-history__cell-primary">{text}</span>
                              {closePrice > 0 && <span className="oi-history__cell-price">₹{closePrice.toFixed(closePrice < 10 ? 2 : closePrice < 100 ? 1 : 0)}</span>}
                            </div>
                            {cell?.peToken && closePrice > 0 && (
                              <div className="oi-history__cell-actions">
                                <button className="oi-history__action-btn oi-history__action-btn--buy" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'PE', 'BUY', strike, exp); }}>B</button>
                                <button className="oi-history__action-btn oi-history__action-btn--sell" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'PE', 'SELL', strike, exp); }}>S</button>
                              </div>
                            )}
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

      {/* Dual-axis chart for selected strike */}
      {chartData && selectedStrike && (
        <div className="oi-history__chart-wrap card">
          <div className="oi-history__chart-header">
            <span className="oi-history__chart-title">Strike {selectedStrike} — Price &amp; OI History</span>
          </div>

          <div className="oi-history__chart-pair">
            {/* CE Chart */}
            {(() => {
              const W = 700, H = 150, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 18;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxCePrice } = chartData;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const barW = Math.min(plotW / n * 0.4, 10);
              const safeMaxPrice = maxCePrice || 1;

              // Build price lines per expiry
              const priceLines = expiries.map((exp) => {
                const pts: { x: number; y: number; price: number; date: string }[] = [];
                dates.forEach((d, i) => {
                  const x = PAD_L + (i + 0.5) * (plotW / n);
                  const entry = dateMap.get(d)?.get(exp);
                  if (entry && entry.ceClose > 0) {
                    const y = PAD_T + plotH - (entry.ceClose / safeMaxPrice) * plotH;
                    pts.push({ x, y, price: entry.ceClose, date: d });
                  }
                });
                return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
              }).filter((l) => l.pts.length > 0);

              return (
                <div className="oi-history__chart-panel">
                  <div className="oi-history__chart-label">CE</div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="oi-history__chart-svg">
                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75].map((frac) => (
                      <line key={frac} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - frac)} y2={PAD_T + plotH * (1 - frac)} stroke="var(--card-border)" strokeWidth="0.5" />
                    ))}
                    {/* X-axis baseline */}
                    <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />

                    {/* OI bars (stacked per expiry) */}
                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      const expiryBars = expiries
                        .map((exp) => ({ exp, oi: dateMap.get(d)?.get(exp)?.ceOi || 0 }))
                        .filter((b) => b.oi > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.oi / maxOi) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={barW - 1} height={barH}
                            fill={expiryColors.get(b.exp)} opacity={0.25} rx={1} />
                        );
                      });
                    })}

                    {/* Price lines + data points with price labels */}
                    {priceLines.map(({ exp, points, pts }) => (
                      <g key={exp}>
                        <polyline points={points} fill="none" stroke={expiryColors.get(exp)} strokeWidth="1.2" strokeLinejoin="round" />
                        {pts.map((p, k) => (
                          <g key={k}>
                            <circle cx={p.x} cy={p.y} r={p.date === filterDate ? 3.5 : 1.5} fill={expiryColors.get(exp)} stroke={p.date === filterDate ? '#fff' : 'none'} strokeWidth={p.date === filterDate ? 0.8 : 0} />
                            <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="4" fill={expiryColors.get(exp)}>
                              ₹{p.price < 10 ? p.price.toFixed(1) : Math.round(p.price)}
                            </text>
                          </g>
                        ))}
                      </g>
                    ))}

                    {/* Average price line */}
                    {(() => {
                      const allPrices = priceLines.flatMap((l) => l.pts.map((p) => p.price));
                      if (allPrices.length === 0) return null;
                      const avg = allPrices.reduce((s, v) => s + v, 0) / allPrices.length;
                      const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;
                      return (
                        <g>
                          <line x1={PAD_L} y1={avgY} x2={W - PAD_R} y2={avgY} stroke="var(--text-secondary)" strokeWidth="0.5" strokeDasharray="3,2" opacity="0.6" />
                          <text x={PAD_L - 4} y={avgY + 2} textAnchor="end" fontSize="5" fill="var(--text-secondary)" opacity="0.7">avg</text>
                        </g>
                      );
                    })()}

                    {/* Deviation lines for days with >20% move from average */}
                    {(() => {
                      const allPts = priceLines.flatMap((l) => l.pts);
                      if (allPts.length === 0) return null;
                      const avg = allPts.reduce((s, p) => s + p.price, 0) / allPts.length;
                      const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;

                      // Group points by date, find max deviation per date
                      const byDate = new Map<string, { above: typeof allPts[0] | null; below: typeof allPts[0] | null; abovePct: number; belowPct: number }>();
                      for (const p of allPts) {
                        const dev = p.price - avg;
                        const pct = avg > 0 ? Math.abs((dev / avg) * 100) : 0;
                        if (!byDate.has(p.date)) {
                          byDate.set(p.date, { above: null, below: null, abovePct: 0, belowPct: 0 });
                        }
                        const entry = byDate.get(p.date)!;
                        if (dev > 0 && pct > entry.abovePct) {
                          entry.above = p;
                          entry.abovePct = pct;
                        }
                        if (dev < 0 && pct > entry.belowPct) {
                          entry.below = p;
                          entry.belowPct = pct;
                        }
                      }

                      // Filter to only days with >= 10% deviation
                      const significantDays = [...byDate.entries()].filter(([, v]) => v.abovePct >= 10 || v.belowPct >= 10);

                      return (
                        <g>
                          {significantDays.map(([date, v]) => (
                            <g key={date}>
                              {v.above && v.abovePct >= 10 && (
                                <>
                                  <line x1={v.above.x} y1={avgY} x2={v.above.x} y2={v.above.y} stroke="var(--accent)" strokeWidth="0.8" opacity="0.6" />
                                  <text x={v.above.x + 3} y={(avgY + v.above.y) / 2 + 2} fontSize="5" fill="var(--accent)" opacity="0.8">+{Math.round(v.abovePct)}%</text>
                                </>
                              )}
                              {v.below && v.belowPct >= 10 && (
                                <>
                                  <line x1={v.below.x} y1={avgY} x2={v.below.x} y2={v.below.y} stroke="var(--accent)" strokeWidth="0.8" opacity="0.6" />
                                  <text x={v.below.x + 3} y={(avgY + v.below.y) / 2 + 2} fontSize="5" fill="var(--accent)" opacity="0.8">-{Math.round(v.belowPct)}%</text>
                                </>
                              )}
                            </g>
                          ))}
                        </g>
                      );
                    })()}

                    {/* Selected date vertical highlight */}
                    {(() => {
                      const dateIdx = dates.indexOf(filterDate);
                      if (dateIdx < 0) return null;
                      const x = PAD_L + (dateIdx + 0.5) * (plotW / n);
                      return <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH} stroke="var(--accent)" strokeWidth="0.7" strokeDasharray="2,2" opacity="0.5" />;
                    })()}

                    {/* Left axis labels (price) */}
                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
                        ₹{Math.round(safeMaxPrice * frac)}
                      </text>
                    ))}

                    {/* Right axis labels (OI) */}
                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
                        {formatOiCompact(Math.round(maxOi * frac))}
                      </text>
                    ))}

                    {/* X-axis date labels */}
                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      return (
                        <text key={d} x={x} y={H - 4} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">
                          {d.slice(5)}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}

            {/* PE Chart */}
            {(() => {
              const W = 700, H = 150, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 18;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxPePrice } = chartData;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const barW = Math.min(plotW / n * 0.4, 10);
              const safeMaxPrice = maxPePrice || 1;

              const priceLines = expiries.map((exp) => {
                const pts: { x: number; y: number; price: number; date: string }[] = [];
                dates.forEach((d, i) => {
                  const x = PAD_L + (i + 0.5) * (plotW / n);
                  const entry = dateMap.get(d)?.get(exp);
                  if (entry && entry.peClose > 0) {
                    const y = PAD_T + plotH - (entry.peClose / safeMaxPrice) * plotH;
                    pts.push({ x, y, price: entry.peClose, date: d });
                  }
                });
                return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
              }).filter((l) => l.pts.length > 0);

              return (
                <div className="oi-history__chart-panel">
                  <div className="oi-history__chart-label oi-history__chart-label--pe">PE</div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="oi-history__chart-svg">
                    {[0.25, 0.5, 0.75].map((frac) => (
                      <line key={frac} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - frac)} y2={PAD_T + plotH * (1 - frac)} stroke="var(--card-border)" strokeWidth="0.5" />
                    ))}
                    {/* X-axis baseline */}
                    <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />

                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      const expiryBars = expiries
                        .map((exp) => ({ exp, oi: dateMap.get(d)?.get(exp)?.peOi || 0 }))
                        .filter((b) => b.oi > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.oi / maxOi) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={barW - 1} height={barH}
                            fill={expiryColors.get(b.exp)} opacity={0.25} rx={1} />
                        );
                      });
                    })}

                    {/* Price lines + data points with price labels */}
                    {priceLines.map(({ exp, points, pts }) => (
                      <g key={exp}>
                        <polyline points={points} fill="none" stroke={expiryColors.get(exp)} strokeWidth="1.2" strokeLinejoin="round" />
                        {pts.map((p, k) => (
                          <g key={k}>
                            <circle cx={p.x} cy={p.y} r={p.date === filterDate ? 3.5 : 1.5} fill={expiryColors.get(exp)} stroke={p.date === filterDate ? '#fff' : 'none'} strokeWidth={p.date === filterDate ? 0.8 : 0} />
                            <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="4" fill={expiryColors.get(exp)}>
                              ₹{p.price < 10 ? p.price.toFixed(1) : Math.round(p.price)}
                            </text>
                          </g>
                        ))}
                      </g>
                    ))}

                    {/* Average price line */}
                    {(() => {
                      const allPrices = priceLines.flatMap((l) => l.pts.map((p) => p.price));
                      if (allPrices.length === 0) return null;
                      const avg = allPrices.reduce((s, v) => s + v, 0) / allPrices.length;
                      const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;
                      return (
                        <g>
                          <line x1={PAD_L} y1={avgY} x2={W - PAD_R} y2={avgY} stroke="var(--text-secondary)" strokeWidth="0.5" strokeDasharray="3,2" opacity="0.6" />
                          <text x={PAD_L - 4} y={avgY + 2} textAnchor="end" fontSize="5" fill="var(--text-secondary)" opacity="0.7">avg</text>
                        </g>
                      );
                    })()}

                    {/* Deviation lines for days with >20% move from average */}
                    {(() => {
                      const allPts = priceLines.flatMap((l) => l.pts);
                      if (allPts.length === 0) return null;
                      const avg = allPts.reduce((s, p) => s + p.price, 0) / allPts.length;
                      const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;

                      // Group points by date, find max deviation per date
                      const byDate = new Map<string, { above: typeof allPts[0] | null; below: typeof allPts[0] | null; abovePct: number; belowPct: number }>();
                      for (const p of allPts) {
                        const dev = p.price - avg;
                        const pct = avg > 0 ? Math.abs((dev / avg) * 100) : 0;
                        if (!byDate.has(p.date)) {
                          byDate.set(p.date, { above: null, below: null, abovePct: 0, belowPct: 0 });
                        }
                        const entry = byDate.get(p.date)!;
                        if (dev > 0 && pct > entry.abovePct) {
                          entry.above = p;
                          entry.abovePct = pct;
                        }
                        if (dev < 0 && pct > entry.belowPct) {
                          entry.below = p;
                          entry.belowPct = pct;
                        }
                      }

                      // Filter to only days with >= 10% deviation
                      const significantDays = [...byDate.entries()].filter(([, v]) => v.abovePct >= 10 || v.belowPct >= 10);

                      return (
                        <g>
                          {significantDays.map(([date, v]) => (
                            <g key={date}>
                              {v.above && v.abovePct >= 10 && (
                                <>
                                  <line x1={v.above.x} y1={avgY} x2={v.above.x} y2={v.above.y} stroke="var(--accent)" strokeWidth="0.8" opacity="0.6" />
                                  <text x={v.above.x + 3} y={(avgY + v.above.y) / 2 + 2} fontSize="5" fill="var(--accent)" opacity="0.8">+{Math.round(v.abovePct)}%</text>
                                </>
                              )}
                              {v.below && v.belowPct >= 10 && (
                                <>
                                  <line x1={v.below.x} y1={avgY} x2={v.below.x} y2={v.below.y} stroke="var(--accent)" strokeWidth="0.8" opacity="0.6" />
                                  <text x={v.below.x + 3} y={(avgY + v.below.y) / 2 + 2} fontSize="5" fill="var(--accent)" opacity="0.8">-{Math.round(v.belowPct)}%</text>
                                </>
                              )}
                            </g>
                          ))}
                        </g>
                      );
                    })()}

                    {/* Selected date vertical highlight */}
                    {(() => {
                      const dateIdx = dates.indexOf(filterDate);
                      if (dateIdx < 0) return null;
                      const x = PAD_L + (dateIdx + 0.5) * (plotW / n);
                      return <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH} stroke="var(--accent)" strokeWidth="0.7" strokeDasharray="2,2" opacity="0.5" />;
                    })()}

                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
                        ₹{Math.round(safeMaxPrice * frac)}
                      </text>
                    ))}

                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
                        {formatOiCompact(Math.round(maxOi * frac))}
                      </text>
                    ))}

                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      return (
                        <text key={d} x={x} y={H - 4} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">
                          {d.slice(5)}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
          </div>

          {/* Legend */}
          <div className="oi-history__chart-legend">
            {expiries.map((exp) => (
              <span key={exp} className="oi-history__chart-legend-item">
                <span className="oi-history__chart-legend-swatch" style={{ background: expiryColors.get(exp) }} />
                {expiryLabel(exp, isMonthlyExpiry(exp))}
              </span>
            ))}
            <span className="oi-history__chart-legend-item">
              <span className="oi-history__chart-legend-bar" /> OI
            </span>
          </div>
        </div>
      )}

      {data.length === 0 && !loading && !fetching && (
        <div className="oi-history__empty card">
          Select a month and click <strong>Fetch</strong> to download multi-expiry OI data.
          Already-fetched days are skipped automatically.
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="oi-confirm-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="oi-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="oi-confirm-modal__title">Delete Month Data</h4>
            <p className="oi-confirm-modal__text">
              Delete ALL OI history data for <strong>{monthOptions.find((m) => m.value === selectedMonth)?.label || selectedMonth}</strong>? This cannot be undone.
            </p>
            <div className="oi-confirm-modal__actions">
              <button className="app-btn app-btn--secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="app-btn app-btn--danger" onClick={handleDeleteMonth}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OiHistory;
