import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleKiteAuthFailure, isKiteAuthFailure } from '@/services/authSession';
import { apiClient, isAbortError } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import AppSelect from '@/components/AppSelect/AppSelect';
import { addPosition } from '@/services/positions';
import { getLotSize } from '@/services/optionChain';
import { fetchQuotes } from '@/services/kiteApi';
import { loadInstruments, getLotSizeByToken } from '@/services/instruments';
import '@/styles/oihistory.css';
import type { OiHistoryRow, FuturesHistoryRow, FetchProgress, SignalPerformanceSummary, TradeSetupStatus, StrikeHistoryEntry, OiCellData, OiTableRow, TradeSignalRow } from './types';
import { DEFAULT_SCRIP_OPTIONS, MAX_RECENT_SCRIPS, loadRecentScrips, saveRecentScrips, currentMonthIST, todayIST, addMonths, formatMonthLabel, formatMonthShortLabel, formatFullDateLabel } from './helpers';
import { summarizePriceTrend, summarizeTradeBias, summarizeTradeLevels, summarizeOptionMomentum, summarizeTradeSetup, summarizePremiumDecay, summarizeSellingSetup, summarizeStrikeBias, classifyPattern, expiryLabel, computeMonthlyExpiries } from './analysis';
import { FuturesContext } from './FuturesContext';
import { OiSnapshotTable } from './OiSnapshotTable';
import { StrikeOiChart } from './StrikeOiChart';
import { TradeSetupDashboard } from './TradeSetupDashboard';
import { computeFlowReadings, marketCloseIST, type FlowInput, type FlowReading } from '@/services/oiFlow';
import { computeFairValues, realizedVol, volVerdict, REALIZED_WINDOW, type FairInput, type FairValueResult } from '@/services/fairValue';

/** When a day's prices were taken: the close, or now for today's rows, which are a live snapshot until the close. */
function snapshotTime(date: string): Date {
  const close = marketCloseIST(date);
  return date === todayIST() ? new Date(Math.min(Date.now(), close.getTime())) : close;
}

/** Fair-value inputs for one day's rows, optionally limited to one expiry. */
function fairInputs(rows: OiHistoryRow[], date: string, expiry?: string): FairInput[] {
  const asOf = snapshotTime(date);
  const inputs: FairInput[] = [];
  for (const r of rows) {
    if (!r.strike || !r.expiry || (r.optionType !== 'CE' && r.optionType !== 'PE') || !(r.spotClose > 0) || !(r.close > 0)) continue;
    if (expiry && r.expiry !== expiry) continue;
    inputs.push({ token: r.instrumentToken, optionType: r.optionType, strike: r.strike, expiry: r.expiry, price: r.close, spot: r.spotClose, asOf, volume: r.volume });
  }
  return inputs;
}

const OiHistory: React.FC = () => {
  const navigate = useNavigate();
  // Cancels this tab's in-flight requests when the user navigates away.
  const pageSignal = useAbortSignal();
  const [scrip, setScrip] = useState('NIFTY50');
  const [selectedExpiryMonth, setSelectedExpiryMonth] = useState(currentMonthIST());
  const [fetching, setFetching] = useState(false);
  const lastFetchedRef = useRef('');
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [futuresData, setFuturesData] = useState<FuturesHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [analysisTab, setAnalysisTab] = useState<'history' | 'setup'>('history');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [signalPerformance, setSignalPerformance] = useState<SignalPerformanceSummary | null>(null);
  const [signalRows, setSignalRows] = useState<TradeSignalRow[]>([]);
  // Bumped after a signal is deleted so the performance stats reload.
  const [signalsVersion, setSignalsVersion] = useState(0);
  const loggedSignalKeysRef = useRef(new Set<string>());
  // Scrip the loaded `data` belongs to. Right after a scrip switch, `scrip` is
  // already new while `data` still holds the previous scrip's rows.
  const [dataScrip, setDataScrip] = useState('');
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(() => new Set());
  const [showVolume, setShowVolume] = useState(false);
  // Fair-value view: the strike chart shows one expiry with its fair-value line.
  const [showFairValue, setShowFairValue] = useState(false);
  const [fairExpiry, setFairExpiry] = useState<string | null>(null);
  const [recentScrips, setRecentScrips] = useState<string[]>(() => loadRecentScrips());
  const [scripOptions, setScripOptions] = useState(DEFAULT_SCRIP_OPTIONS);
  const [expiryMonthOptions, setExpiryMonthOptions] = useState<{ value: string; label: string }[]>(() => {
    const current = currentMonthIST();
    return [{ value: current, label: formatMonthLabel(current) }];
  });

  const selectScrip = useCallback((nextScrip: string) => {
    setScrip(nextScrip);
    setRecentScrips((prev) => {
      const next = [nextScrip, ...prev.filter((value) => value !== nextScrip)].slice(0, MAX_RECENT_SCRIPS);
      saveRecentScrips(next);
      return next;
    });
  }, []);

  const recentScripOptions = useMemo(() => {
    const labels = new Map(scripOptions.map((option) => [option.value, option.label]));
    return recentScrips
      .filter((value) => value !== scrip)
      .map((value) => ({ value, label: labels.get(value) || value }));
  }, [recentScrips, scrip, scripOptions]);
  const [strikeRange, setStrikeRange] = useState<number>(() => {
    const stored = localStorage.getItem('optiontrap_strike_range');
    const val = stored ? parseInt(stored, 10) : 10;
    return [-1, 0, 5, 10, 20].includes(val) ? val : 10;
  });
  const [specificStrike, setSpecificStrike] = useState<string>(() => localStorage.getItem('optiontrap_specific_strike') || '');
  const specificStrikeValue = useMemo(() => {
    const value = Number(specificStrike);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [specificStrike]);

  // Warm the instruments cache so lot sizes are available for setup trades.
  useEffect(() => {
    loadInstruments().catch(() => { /* lot size falls back to 1 if unavailable */ });
  }, []);

  // Fetch available future expiry months for the selected scrip from instruments
  useEffect(() => {
    const current = currentMonthIST();
    let stale = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setFetchError(null);
    const requestMonths = () => apiClient.get<{ status: string; months?: string[]; message?: string }>(`/api/oi-history/expiry-months?scrip=${scrip}`, { signal: pageSignal });
    // Retry once: on the first login of the day the server may still be building
    // its instruments cache, and a transient failure would otherwise leave only
    // the current month in the dropdown.
    requestMonths()
      .catch((err) => {
        if (isAbortError(err) || stale) throw err;
        return new Promise<void>((resolve) => { retryTimer = setTimeout(resolve, 3000); })
          .then(() => {
            if (stale) throw new DOMException('Superseded', 'AbortError');
            return requestMonths();
          });
      })
      .then((json) => {
        if (stale) return;
        if (json.status === 'ok') {
          const months: string[] = json.months || [];
          if (months.length > 0) {
            const selectableMonths = months.filter((month) => month >= current);
            const selectedMonths = selectableMonths.length > 0 ? selectableMonths : [current];
            const options = months.map((m) => ({ value: m, label: formatMonthLabel(m) }));
            setExpiryMonthOptions(options);
            setSelectedExpiryMonth((prev) => selectedMonths.includes(prev) ? prev : selectedMonths[0]);
          } else {
            setExpiryMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
            setSelectedExpiryMonth(current);
          }
        } else {
          throw new Error(json.message || 'Failed to load expiry months');
        }
      })
      .catch((err) => {
        if (isAbortError(err) || stale) return;
        setExpiryMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
        setSelectedExpiryMonth(current);
        setFetchError(err instanceof Error ? err.message : 'Failed to load expiry months');
      });
    return () => {
      // A newer scrip's request supersedes this one.
      stale = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [scrip]);

  // Fetch available F&O symbols on mount
  useEffect(() => {
    apiClient.get<string[]>('/api/fno-symbols', { signal: pageSignal })
      .then((symbols) => {
        if (symbols.length > 0) {
          const options = symbols.map((name: string) => ({
            value: name === 'NIFTY' ? 'NIFTY50' : name,
            label: name === 'NIFTY' ? 'NIFTY 50' : name === 'BANKNIFTY' ? 'BANK NIFTY' : name,
          }));
          setScripOptions(options);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  const selectableExpiryMonthOptions = useMemo(() => {
    const current = currentMonthIST();
    const options = expiryMonthOptions.filter((option) => option.value >= current);
    return options.length > 0 ? options : [{ value: current, label: formatMonthLabel(current) }];
  }, [expiryMonthOptions]);

  /** Expiry months to include: only M-1 from history, then current month through selected month. */
  const includedExpiryMonths = useMemo(() => {
    const current = currentMonthIST();
    const previous = addMonths(current, -1);
    return expiryMonthOptions
      .map((o) => o.value)
      .filter((m) => m === previous || (m >= current && m <= selectedExpiryMonth))
      .sort();
  }, [expiryMonthOptions, selectedExpiryMonth]);

  /** Only current/future expiry months can be fetched from the current instruments cache. */
  const fetchableExpiryMonths = useMemo(() => {
    const current = currentMonthIST();
    return includedExpiryMonths.filter((month) => month >= current);
  }, [includedExpiryMonths]);

  /** Load stored data from server — includes M-1 if stored, then current month through selected month. */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        includedExpiryMonths.map(async (month) => {
          const params = new URLSearchParams({ scrip, expiryMonth: month });
          return apiClient.get<OiHistoryRow[]>(`/api/oi-history?${params}`, { signal: pageSignal });
        }),
      );
      // Futures follow the same months as OI history, including stored M-1 rows.
      const futuresResults = await Promise.all(
        includedExpiryMonths.map(async (month) => {
          const futuresParams = new URLSearchParams({ scrip, expiryMonth: month });
          return apiClient.get<FuturesHistoryRow[]>(`/api/oi-history/futures?${futuresParams}`, { signal: pageSignal });
        }),
      );
      const merged = results.flat();
      setData(merged);
      setDataScrip(scrip);
      setFuturesData(futuresResults.flat());
      if (merged.length > 0) {
        const dates = [...new Set(merged.map((r) => r.date))].sort();
        const current = currentMonthIST();
        const visibleDates = dates.filter((date) => date.slice(0, 7) >= current);
        setFilterDate((visibleDates[visibleDates.length - 1] || dates[dates.length - 1]) as string);
      }
    } catch (err) {
      if (!isAbortError(err)) console.error('[OiHistory] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [scrip, includedExpiryMonths, pageSignal]);

  /** Stream a single expiry-month fetch from Kite via SSE. Returns on stream end. */
  const fetchExpiryMonth = useCallback(async (month: string, monthLabel: string) => {
    const res = await apiClient.raw('/api/oi-history/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        scrip,
        expiryMonth: month,
        strikeMode: strikeRange === -1 ? 'specific' : strikeRange === 0 ? 'allStored' : 'atmRange',
        specificStrike: strikeRange === -1 ? specificStrikeValue : undefined,
      },
      signal: pageSignal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Server error (${res.status})`);
    }
    if (!res.body) {
      throw new Error('Server returned an empty response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleEvent = (eventType: string, dataStr: string) => {
      if (!eventType || !dataStr) return;
      let payload: any;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        return; // ignore malformed SSE data
      }
      switch (eventType) {
        case 'step':
          setProgress({ step: `${monthLabel}: ${payload.message}`, pct: 0, detail: '' });
          break;
        case 'progress':
          setProgress((prev) => {
            if (prev && payload.pct < prev.pct && prev.step.startsWith(monthLabel)) return prev;
            return {
              step: `${monthLabel}: Fetching OI data...`,
              pct: payload.pct,
              detail: `${payload.done}/${payload.total} instruments (batch ${payload.batch}/${payload.totalBatches})`,
            };
          });
          break;
        case 'error':
          throw new Error(payload.message);
      }
    };

    // Parse complete SSE event blocks (separated by a blank line). Robust to
    // network chunks splitting anywhere, including between "event:"/"data:".
    const processBlock = (block: string) => {
      let eventType = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataStr += line.slice(5).replace(/^ /, '');
        }
      }
      handleEvent(eventType, dataStr);
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (block.trim()) processBlock(block);
      }
    }
    if (buffer.trim()) processBlock(buffer);
  }, [scrip, strikeRange, specificStrikeValue, pageSignal]);

  /** Fetch current/future included expiry months from Kite. Historical months are loaded from DB only. */
  const handleFetch = useCallback(async () => {
    if (strikeRange === -1 && specificStrikeValue === null) {
      setFetchError('Enter a valid strike to fetch specific OI history.');
      return;
    }

    if (fetchableExpiryMonths.length === 0) {
      setFetchResult('Selected month is historical only. Stored database data is already loaded.');
      return;
    }

    setFetching(true);
    setProgress({ step: 'Connecting...', pct: 0, detail: '' });
    setFetchResult(null);
    setFetchError(null);

    try {
      for (const month of fetchableExpiryMonths) {
        const label = formatMonthShortLabel(month);
        await fetchExpiryMonth(month, label);
      }
      setProgress(null);
    } catch (err) {
      if (isAbortError(err)) return;
      const message = err instanceof Error ? err.message : 'Network error';
      if (isKiteAuthFailure(message)) {
        handleKiteAuthFailure();
        navigate('/login', { replace: true });
      } else {
        setFetchError(message);
      }
      setProgress(null);
    } finally {
      setFetching(false);
      if (!pageSignal.aborted) loadData();
    }
  }, [fetchableExpiryMonths, fetchExpiryMonth, loadData, navigate, strikeRange, specificStrikeValue, pageSignal]);

  // When scrip or expiry month changes, load existing data from the DB only.
  // Fetching fresh data from Kite is an explicit action via the Fetch button.
  useEffect(() => {
    const key = `${scrip}_${selectedExpiryMonth}`;
    if (lastFetchedRef.current === key) return;
    lastFetchedRef.current = key;

    // Clear old data immediately so stale content isn't shown
    setData([]);
    setDataScrip('');
    setSelectedStrike(null);
    setFilterDate('');
    setFetchResult(null);
    setFetchError(null);

    loadData();
  }, [scrip, selectedExpiryMonth, loadData]);

  /** Delete all OI history for the selected scrip */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCleanOld, setConfirmCleanOld] = useState(false);
  const [isDataMenuOpen, setIsDataMenuOpen] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement | null>(null);
  const cleanupCutoffMonth = addMonths(currentMonthIST(), -1);
  const cleanupCutoffLabel = formatMonthLabel(cleanupCutoffMonth);

  useEffect(() => {
    if (!isDataMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!dataMenuRef.current?.contains(event.target as Node)) {
        setIsDataMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDataMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDataMenuOpen]);

  const handleDeleteMonth = useCallback(async () => {
    setConfirmDelete(false);

    try {
      const params = new URLSearchParams({ scrip });
      const json = await apiClient.delete<{ status: string; message?: string }>(`/api/oi-history?${params}`);
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
  }, [scrip]);

  const handleCleanOld = useCallback(async () => {
    setConfirmCleanOld(false);
    setFetchResult(null);
    setFetchError(null);

    try {
      const params = new URLSearchParams({ scrip, beforeExpiryMonth: cleanupCutoffMonth });
      const json = await apiClient.delete<{ status: string; deleted?: number; message?: string }>(`/api/oi-history/old?${params}`);
      if (json.status === 'ok') {
        const deleted = Number(json.deleted || 0);
        setFetchResult(deleted > 0
          ? `Deleted ${deleted} old OI history row(s) before ${cleanupCutoffLabel}.`
          : `No old OI history rows found before ${cleanupCutoffLabel}.`);
        lastFetchedRef.current = '';
        loadData();
      } else {
        setFetchError(json.message || 'Failed to clean old data');
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    }
  }, [scrip, cleanupCutoffMonth, cleanupCutoffLabel, loadData]);

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
    const historicalClose = optionType === 'CE' ? cell.ceClose : cell.peClose;

    if (!token || !tradingsymbol || !historicalClose) return;

    try {
      // Enter at the current live/last-traded price so the position opens near
      // break-even, rather than the historical close from the OI-history grid
      // (which can differ materially from the current market price).
      let entryPrice = historicalClose;
      try {
        const quotes = await fetchQuotes([`NFO:${tradingsymbol}`]);
        const ltp = quotes.get(`NFO:${tradingsymbol}`)?.last_price;
        if (ltp && ltp > 0) entryPrice = ltp;
      } catch {
        // Quote unavailable — fall back to the historical close.
      }

      await addPosition({
        tradingsymbol,
        instrumentToken: token,
        strike,
        optionType,
        side,
        quantity: getLotSizeByToken(token) ?? getLotSize(token),
        entryPrice,
        expiry,
      });
      showToast(`${side} ${strike}${optionType} @ ₹${entryPrice.toFixed(2)}`, 'green');
    } catch {
      showToast('Failed to add position', 'red');
    }
  }, [showToast]);

  /** Unique dates in the loaded data */
  const availableDates = useMemo(() => {
    return [...new Set(data.map((r) => r.date))].sort();
  }, [data]);

  const visibleDates = useMemo(() => {
    return availableDates.filter((date) => date.slice(0, 7) >= currentMonthIST());
  }, [availableDates]);

  /** Dates grouped by month (YYYY-MM) for a clearer date bar */
  const datesByMonth = useMemo(() => {
    const groups: { month: string; dates: string[] }[] = [];
    let current: { month: string; dates: string[] } | null = null;
    for (const d of visibleDates) {
      const month = d.slice(0, 7);
      if (!current || current.month !== month) {
        current = { month, dates: [] };
        groups.push(current);
      }
      current.dates.push(d);
    }
    return groups;
  }, [visibleDates]);

  /** Unique expiries in the loaded data for the selected expiry month, sorted */
  const expiries = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      if (r.expiry) set.add(r.expiry);
    }
    return [...set].sort();
  }, [data]);

  const monthlyExpirySet = useMemo(() => computeMonthlyExpiries(expiries), [expiries]);
  const isMonthlyExpiry = useCallback(
    (expiry: string) => monthlyExpirySet.has(expiry),
    [monthlyExpirySet],
  );

  /** Mark only actual contract expiry dates; weekdays can vary around holidays. */
  const expiryMarkerDates = useMemo(() => new Set(expiries), [expiries]);

  /** Rows for the selected date */
  const filteredRows = useMemo(() => {
    if (!filterDate) return [];
    return data.filter((r) => r.date === filterDate);
  }, [data, filterDate]);

  /** Expiries available on the selected date. Expired weekly contracts are not shown after expiry. */
  const tableExpiries = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredRows) {
      if (r.expiry) set.add(r.expiry);
    }
    return [...set].sort();
  }, [filteredRows]);

  const visibleTableExpiries = useMemo(() => {
    return tableExpiries.filter((exp) => !hiddenExpiries.has(exp));
  }, [tableExpiries, hiddenExpiries]);

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

  /** Daily OI per token, oldest first, for judging how unusual and how recent an OI change is. */
  const oiSeriesByToken = useMemo(() => {
    const map = new Map<number, { date: string; oi: number }[]>();
    for (const r of data) {
      if (!r.optionType) continue;
      const list = map.get(r.instrumentToken);
      if (list) list.push({ date: r.date, oi: r.oi });
      else map.set(r.instrumentToken, [{ date: r.date, oi: r.oi }]);
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return map;
  }, [data]);

  /** IV-based flow for every option on the selected date, keyed by instrument token. */
  const flowByToken = useMemo(() => {
    const idx = availableDates.indexOf(filterDate);
    if (idx <= 0) return new Map<number, FlowReading>();
    const prevDate = availableDates[idx - 1];
    const prevSpot = prevDateRows.find((r) => r.spotClose > 0)?.spotClose;
    const asOf = snapshotTime(filterDate);
    const prevAsOf = marketCloseIST(prevDate);

    const inputs: FlowInput[] = [];
    for (const r of filteredRows) {
      if (!r.strike || !r.expiry || (r.optionType !== 'CE' && r.optionType !== 'PE') || !(r.spotClose > 0)) continue;
      const oiHistory = (oiSeriesByToken.get(r.instrumentToken) ?? [])
        .filter((entry) => entry.date < filterDate)
        .map((entry) => entry.oi);
      inputs.push({
        token: r.instrumentToken,
        optionType: r.optionType,
        strike: r.strike,
        expiry: r.expiry,
        oi: r.oi,
        prevOi: prevDayOi.get(r.instrumentToken),
        price: r.close,
        prevPrice: prevDayClose.get(r.instrumentToken),
        spot: r.spotClose,
        prevSpot,
        asOf,
        prevAsOf,
        volume: r.volume,
        oiHistory,
      });
    }
    return computeFlowReadings(inputs);
  }, [filteredRows, prevDateRows, prevDayOi, prevDayClose, oiSeriesByToken, availableDates, filterDate]);

  /** Fair value for every option on the selected date (logged with signals, and the chart summary). */
  const fairToday = useMemo(() => computeFairValues(fairInputs(filteredRows, filterDate)), [filteredRows, filterDate]);

  /** Expiry the fair-value chart shows: the picked one if still visible, else the nearest. */
  const chartFairExpiry = useMemo(() => {
    if (!showFairValue) return null;
    return fairExpiry && visibleTableExpiries.includes(fairExpiry) ? fairExpiry : visibleTableExpiries[0] ?? null;
  }, [showFairValue, fairExpiry, visibleTableExpiries]);

  const chartExpiries = useMemo(
    () => (chartFairExpiry ? [chartFairExpiry] : visibleTableExpiries),
    [chartFairExpiry, visibleTableExpiries],
  );

  /** Rows and spot close per date. */
  const rowsByDate = useMemo(() => {
    const map = new Map<string, OiHistoryRow[]>();
    for (const r of data) {
      const list = map.get(r.date);
      if (list) list.push(r);
      else map.set(r.date, [r]);
    }
    return map;
  }, [data]);

  /** Fair values of the chart's expiry on every date; only computed while the fair-value view is on. */
  const fairByDate = useMemo(() => {
    const map = new Map<string, FairValueResult>();
    if (!chartFairExpiry) return map;
    for (const [date, rows] of rowsByDate) map.set(date, computeFairValues(fairInputs(rows, date, chartFairExpiry)));
    return map;
  }, [rowsByDate, chartFairExpiry]);

  /** Chain context for the fair-value view: ATM IV vs realised vol and the expected move. */
  const fairSummary = useMemo(() => {
    if (!chartFairExpiry || !filterDate) return null;
    const stats = fairToday.byExpiry.get(chartFairExpiry) ?? null;
    const spotCloses = availableDates
      .filter((date) => date <= filterDate)
      .map((date) => rowsByDate.get(date)?.find((r) => r.spotClose > 0)?.spotClose ?? 0);
    const realized = realizedVol(spotCloses);
    const spot = filteredRows.find((r) => r.spotClose > 0)?.spotClose ?? null;
    return { stats, realized, verdict: volVerdict(stats?.atmIv ?? null, realized), spot };
  }, [chartFairExpiry, filterDate, fairToday, availableDates, rowsByDate, filteredRows]);

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
    if (strikeRange === -1 && specificStrikeValue !== null) {
      setSelectedStrike(specificStrikeValue);
      return;
    }
    if (atmStrike) {
      setSelectedStrike(atmStrike);
    }
  }, [atmStrike, strikeRange, specificStrikeValue]);

  /** Build table data: rows = strikes, columns = expiries */
  const tableData = useMemo(() => {
    if (filteredRows.length === 0 || visibleTableExpiries.length === 0) return [];

    // Index: strike → expiry → { ce, pe }
    const grid = new Map<number, Map<string, OiCellData>>();

    const visibleExpirySet = new Set(visibleTableExpiries);

    for (const r of filteredRows) {
      if (!r.strike || !r.optionType || !r.expiry) continue;
      if (!visibleExpirySet.has(r.expiry)) continue;

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

        const cePattern = classifyPattern(ceByExpiry, visibleTableExpiries);
        const pePattern = classifyPattern(peByExpiry, visibleTableExpiries);
        const weeklyExpiries = visibleTableExpiries.filter((exp) => !isMonthlyExpiry(exp) && expiryMap.has(exp));
        const consolidatedExpiries = weeklyExpiries.length > 0 ? weeklyExpiries : visibleTableExpiries;
        const consolidatedOi = consolidatedExpiries.reduce(
          (total, exp) => {
            const cell = expiryMap.get(exp);
            if (!cell) return total;
            return {
              ce: total.ce + cell.ceOi,
              pe: total.pe + cell.peOi,
            };
          },
          { ce: 0, pe: 0 },
        );

        return {
          strike,
          cells: expiryMap,
          cePattern,
          pePattern,
          ceConsolidatedOi: consolidatedOi.ce,
          peConsolidatedOi: consolidatedOi.pe,
          dimmed: !hasSignificantOi,
        };
      }) as OiTableRow[];

    if (strikeRange === -1) {
      return specificStrikeValue === null ? [] : rows.filter((row) => row.strike === specificStrikeValue);
    }

    // Limit strikes around ATM based on selected range
    if (strikeRange > 0 && atmStrike && rows.length > 0) {
      const atmIdx = rows.findIndex((r) => r.strike >= atmStrike);
      const center = atmIdx >= 0 ? atmIdx : Math.floor(rows.length / 2);
      const start = Math.max(0, center - strikeRange);
      const end = Math.min(rows.length, center + strikeRange + 1);
      return rows.slice(start, end);
    }

    return rows;
  }, [filteredRows, visibleTableExpiries, prevDayOi, prevDayClose, scrip, atmStrike, strikeRange, specificStrikeValue]);

  const maxConsolidatedOi = useMemo(() => {
    let max = 0;
    for (const row of tableData) {
      if (row.ceConsolidatedOi > max) max = row.ceConsolidatedOi;
      if (row.peConsolidatedOi > max) max = row.peConsolidatedOi;
    }
    return max;
  }, [tableData]);

  // When the selected strike is no longer visible in the table (e.g. after
  // narrowing the strike range), fall back to the ATM strike if it's visible,
  // otherwise clear the selection.
  useEffect(() => {
    if (selectedStrike === null) return;
    if (strikeRange === -1) return;
    if (tableData.some((r) => r.strike === selectedStrike)) return;
    if (atmStrike && tableData.some((r) => r.strike === atmStrike)) {
      setSelectedStrike(atmStrike);
    } else {
      setSelectedStrike(null);
    }
  }, [tableData, selectedStrike, atmStrike, strikeRange]);

  /** Chart data for selected strike across all dates */
  const chartData = useMemo(() => {
    if (!selectedStrike || availableDates.length === 0 || visibleTableExpiries.length === 0) return null;

    // Group data by date+expiry for the selected strike
    const dateMap = new Map<string, Map<string, StrikeHistoryEntry>>();
    const spotByDate = new Map<string, number>();
    const tableExpirySet = new Set(visibleTableExpiries);

    for (const r of data) {
      if (r.strike !== selectedStrike || !r.expiry || !tableExpirySet.has(r.expiry)) continue;
      if (r.spotClose > 0) spotByDate.set(r.date, r.spotClose);
      if (!dateMap.has(r.date)) dateMap.set(r.date, new Map());
      const expMap = dateMap.get(r.date)!;
      if (!expMap.has(r.expiry)) {
        expMap.set(r.expiry, {
          ceOi: 0,
          peOi: 0,
          ceClose: 0,
          peClose: 0,
          ceVolume: 0,
          peVolume: 0,
        });
      }
      const entry = expMap.get(r.expiry)!;
      const fair = fairByDate.get(r.date)?.byToken.get(r.instrumentToken);
      if (r.optionType === 'CE') {
        entry.ceOi = r.oi;
        entry.ceClose = r.close;
        entry.ceVolume = r.volume;
        entry.ceFair = fair?.fairPrice ?? null;
        entry.ceRichPct = fair?.richPct ?? null;
        entry.ceFairLabel = fair?.label ?? null;
      } else {
        entry.peOi = r.oi;
        entry.peClose = r.close;
        entry.peVolume = r.volume;
        entry.peFair = fair?.fairPrice ?? null;
        entry.peRichPct = fair?.richPct ?? null;
        entry.peFairLabel = fair?.label ?? null;
      }
    }

    const dates = availableDates.filter((d) => dateMap.has(d));
    if (dates.length === 0) return null;
    const biasSummary = summarizeStrikeBias(dates, dateMap, visibleTableExpiries, spotByDate);
    const priceTrend = summarizePriceTrend(dates, spotByDate);
    const tradeBias = summarizeTradeBias(priceTrend, biasSummary);
    const latestSpot = priceTrend.endPrice ?? selectedSpotClose;
    const tradeLevels = summarizeTradeLevels(tableData, latestSpot, selectedStrike);
    const optionMomentum = summarizeOptionMomentum(dates, dateMap, visibleTableExpiries, priceTrend, tradeLevels);
    const premiumDecay = summarizePremiumDecay(dates, dateMap, visibleTableExpiries, priceTrend, tradeLevels);
    const tradeSetup = summarizeTradeSetup(priceTrend, biasSummary, selectedStrike, tradeLevels, optionMomentum);
    const sellingSetup = summarizeSellingSetup(priceTrend, biasSummary, selectedStrike, tradeLevels, premiumDecay);

    // Find max values for axis scaling (prices only over the expiries the chart draws)
    const drawnExpiries = new Set(chartExpiries);
    let maxOi = 0;
    let maxCePrice = 0;
    let maxPePrice = 0;
    for (const [, expMap] of dateMap) {
      for (const [exp, v] of expMap) {
        if (v.ceOi > maxOi) maxOi = v.ceOi;
        if (v.peOi > maxOi) maxOi = v.peOi;
        if (!drawnExpiries.has(exp)) continue;
        maxCePrice = Math.max(maxCePrice, v.ceClose, v.ceFair ?? 0);
        maxPePrice = Math.max(maxPePrice, v.peClose, v.peFair ?? 0);
      }
    }

    return { dates, dateMap, maxOi, maxCePrice, maxPePrice, biasSummary, priceTrend, tradeBias, tradeSetup, tradeLevels, optionMomentum, premiumDecay, sellingSetup };
  }, [data, selectedStrike, availableDates, visibleTableExpiries, selectedSpotClose, tableData, fairByDate, chartExpiries]);

  // Persist each actionable setup once per session/date. This creates the
  // evidence needed for later outcome tracking and backtesting without
  // creating another UI section.
  useEffect(() => {
    if (!chartData || !selectedStrike || chartData.dates.length === 0 || dataScrip !== scrip) return;
    const selling = chartData.sellingSetup;
    const buying = chartData.tradeSetup;
    let action: 'BUY' | 'SELL' | null = null;
    let optionType: 'CE' | 'PE' | null = null;
    let setupStatus: TradeSetupStatus = 'Avoid';

    if ((selling.type === 'Call Sell' || selling.type === 'Put Sell') && selling.status !== 'Avoid') {
      action = 'SELL';
      optionType = selling.type === 'Call Sell' ? 'CE' : 'PE';
      setupStatus = selling.status;
    } else if ((buying.direction === 'Bullish' || buying.direction === 'Bearish') && buying.status !== 'Avoid') {
      action = 'BUY';
      optionType = buying.direction === 'Bullish' ? 'CE' : 'PE';
      setupStatus = buying.status;
    }
    if (!action || !optionType) return;

    const signalDate = chartData.dates[chartData.dates.length - 1];
    const expiry = chartData.premiumDecay.nearestExpiry;
    const side = optionType === 'CE' ? chartData.premiumDecay.ce : chartData.premiumDecay.pe;

    // Log one setup per scrip per day: only the ATM strike on the signal date.
    const signalDayRows = data.filter((row) => row.date === signalDate && row.strike);
    const signalDaySpot = signalDayRows[0]?.spotClose;
    if (!signalDaySpot) return;
    const signalDayAtm = signalDayRows.reduce<number | null>((best, row) => (
      best === null || Math.abs(row.strike! - signalDaySpot) < Math.abs(best - signalDaySpot) ? row.strike! : best
    ), null);
    if (selectedStrike !== signalDayAtm) return;

    // The expiry comes from the selected date's table. When viewing an older
    // date it can be a contract that has expired by the signal date, so take
    // the entry premium from the signal date itself and skip if it has none.
    const signalDayEntry = expiry ? chartData.dateMap.get(signalDate)?.get(expiry) : undefined;
    const entryPremium = signalDayEntry ? (optionType === 'CE' ? signalDayEntry.ceClose : signalDayEntry.peClose) : 0;
    if (!expiry || expiry < signalDate || !(entryPremium > 0)) return;

    const key = `${scrip}|${signalDate}|${expiry}|${selectedStrike}|${optionType}|${action}`;
    if (loggedSignalKeysRef.current.has(key)) return;
    loggedSignalKeysRef.current.add(key);

    // The table shows the selected date, so its OI pattern only describes the
    // signal when that date is the signal date. Otherwise leave it out; the
    // server merges details, so a pattern recorded earlier is kept.
    const strikeRow = filterDate === signalDate ? tableData.find((row) => row.strike === selectedStrike) : undefined;
    const strikePattern = strikeRow ? (optionType === 'CE' ? strikeRow.cePattern : strikeRow.pePattern) : null;
    const strikeCell = strikeRow?.cells.get(expiry);
    const flowToken = strikeCell ? (optionType === 'CE' ? strikeCell.ceToken : strikeCell.peToken) : undefined;
    const ivFlow = flowToken !== undefined ? flowByToken.get(flowToken)?.label : undefined;
    const fair = flowToken !== undefined ? fairToday.byToken.get(flowToken) : undefined;

    void apiClient.post('/api/oi-history/signals', {
        scrip,
        signalDate,
        expiry,
        strike: selectedStrike,
        optionType,
        action,
        status: setupStatus,
        entryPremium,
        spotPrice: chartData.priceTrend.endPrice ?? null,
        details: {
          priceTrend: chartData.priceTrend,
          sellingType: selling.type,
          sellingStatus: selling.status,
          buyingDirection: buying.direction,
          buyingStatus: buying.status,
          buyingMomentum: optionType === 'CE' ? chartData.optionMomentum.ce : chartData.optionMomentum.pe,
          decay: side ? { decayPct: side.decayPct, score: side.score, daysToExpiry: side.daysToExpiry, latestVolume: side.latestVolume } : null,
          flowBias: chartData.biasSummary.bias,
          ...(strikePattern && strikePattern !== '-' ? { strikePattern } : {}),
          ...(ivFlow && ivFlow !== '-' ? { ivFlow } : {}),
          ...(fair?.label ? { fairValue: fair.label, fairRichPct: fair.richPct !== null ? Math.round(fair.richPct * 1000) / 10 : null } : {}),
        },
      },
    ).catch(() => {
      // Logging must never affect the Trade Setup UI.
    });
  }, [chartData, data, scrip, dataScrip, selectedStrike, filterDate, tableData, flowByToken, fairToday]);

  useEffect(() => {
    if (!chartData || !scrip) return;
    void (async () => {
      try {
        const result = await apiClient.get<{ signals?: TradeSignalRow[] }>(
          `/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=500`,
          { signal: pageSignal },
        );
        const signals = result.signals || [];
        setSignalRows(signals);
        const openSignals = signals.filter((signal) => signal.outcome_status === 'Open' || signal.outcome_status === null);
        const openReturns = openSignals
          .map((signal) => signal.outcome_return)
          .filter((value): value is number => value !== null && Number.isFinite(Number(value)))
          .map(Number);
        const evaluated = signals.filter((signal) => signal.outcome_status === 'Profit' || signal.outcome_status === 'Loss');
        const wins = evaluated.filter((signal) => signal.outcome_status === 'Profit').length;
        const average = evaluated.length ? evaluated.reduce((sum, signal) => sum + Number(signal.outcome_return || 0), 0) / evaluated.length : null;
        const favorableRows = evaluated.filter((signal) => signal.max_favorable_return !== null);
        const adverseRows = evaluated.filter((signal) => signal.max_adverse_return !== null);
        const averageMaxFavorable = favorableRows.length
          ? favorableRows.reduce((sum, signal) => sum + Number(signal.max_favorable_return), 0) / favorableRows.length
          : null;
        const averageMaxAdverse = adverseRows.length
          ? adverseRows.reduce((sum, signal) => sum + Number(signal.max_adverse_return), 0) / adverseRows.length
          : null;
        const winningReturns = evaluated.map((signal) => Number(signal.outcome_return || 0)).filter((value) => value > 0);
        const losingReturns = evaluated.map((signal) => Number(signal.outcome_return || 0)).filter((value) => value < 0);
        const grossProfit = winningReturns.reduce((sum, value) => sum + value, 0);
        const grossLoss = Math.abs(losingReturns.reduce((sum, value) => sum + value, 0));
        const averageWin = winningReturns.length ? grossProfit / winningReturns.length : null;
        const averageLoss = losingReturns.length ? -grossLoss / losingReturns.length : null;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);
        const byAction = (action: 'BUY' | 'SELL') => {
          const rows = evaluated.filter((signal) => signal.action === action);
          return { count: rows.length, wins: rows.filter((signal) => signal.outcome_status === 'Profit').length };
        };
        const sells = byAction('SELL');
        const buys = byAction('BUY');
        setSignalPerformance({
          total: signals.length,
          open: openSignals.length,
          averageOpenReturn: openReturns.length ? openReturns.reduce((sum, value) => sum + value, 0) / openReturns.length : null,
          evaluated: evaluated.length,
          wins,
          winRate: evaluated.length ? (wins / evaluated.length) * 100 : null,
          averageReturn: average,
          averageMaxFavorable,
          averageMaxAdverse,
          averageWin,
          averageLoss,
          profitFactor,
          sellEvaluated: sells.count,
          sellWinRate: sells.count ? (sells.wins / sells.count) * 100 : null,
          buyEvaluated: buys.count,
          buyWinRate: buys.count ? (buys.wins / buys.count) * 100 : null,
        });
      } catch {
        // Research metrics are optional and must never block the setup.
      }
    })();
  }, [chartData, scrip, pageSignal, signalsVersion]);

  const deleteSignal = useCallback(async (id: number) => {
    try {
      await apiClient.delete(`/api/oi-history/signals/${id}`);
      setSignalRows((rows) => rows.filter((row) => row.id !== id));
      setSignalsVersion((version) => version + 1);
    } catch {
      showToast('Failed to delete signal', 'red');
    }
  }, [showToast]);

  /**
   * Resolve the strike/side/optionType a trade setup recommends and place it.
   * Reuses handleTrade so token/tradingsymbol/price come from the OI grid.
   *   mode 'buy'  → BUY; CE for Bullish, PE for Bearish
   *   mode 'sell' → SELL; CE for Call Sell, PE for Put Sell
   * Strike = setup's key level (resistance for CE side, support for PE side),
   * falling back to ATM / max-OI magnet when the level is missing.
   */
  const tradeFromSetup = useCallback((mode: 'buy' | 'sell') => {
    if (!chartData) return;
    const { tradeSetup, sellingSetup, tradeLevels } = chartData;

    let optionType: 'CE' | 'PE' | null = null;
    let side: 'BUY' | 'SELL';
    if (mode === 'buy') {
      side = 'BUY';
      if (tradeSetup.direction === 'Bullish') optionType = 'CE';
      else if (tradeSetup.direction === 'Bearish') optionType = 'PE';
    } else {
      side = 'SELL';
      if (sellingSetup.type === 'Call Sell') optionType = 'CE';
      else if (sellingSetup.type === 'Put Sell') optionType = 'PE';
    }

    if (!optionType) {
      showToast('No single-leg strike for this setup', 'red');
      return;
    }

    // CE side leans to resistance, PE side to support; fall back to ATM/max-OI.
    const keyLevel = optionType === 'CE' ? tradeLevels.resistanceStrike : tradeLevels.supportStrike;
    const targetStrike = keyLevel ?? atmStrike ?? tradeLevels.maxOiStrike;
    if (!targetStrike) {
      showToast('No tradeable strike found', 'red');
      return;
    }

    const row = tableData.find((r) => r.strike === targetStrike);
    if (!row) {
      showToast(`Strike ${targetStrike} not in table`, 'red');
      return;
    }

    // Pick the nearest visible expiry that has a live cell for this option type.
    type RowCell = ReturnType<typeof row.cells.get>;
    let chosenCell: RowCell;
    let chosenExpiry: string | undefined;
    for (const exp of visibleTableExpiries) {
      const cell = row.cells.get(exp);
      if (!cell) continue;
      const token = optionType === 'CE' ? cell.ceToken : cell.peToken;
      const price = optionType === 'CE' ? cell.ceClose : cell.peClose;
      if (token && price) {
        chosenCell = cell;
        chosenExpiry = exp;
        break;
      }
    }

    if (!chosenCell || !chosenExpiry) {
      showToast(`No ${optionType} data at strike ${targetStrike}`, 'red');
      return;
    }

    void handleTrade(chosenCell, optionType, side, targetStrike, chosenExpiry);
  }, [chartData, atmStrike, tableData, visibleTableExpiries, handleTrade, showToast]);

  /** Expiry colors for chart lines */
  const expiryColors = useMemo(() => {
    const palette = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'];
    const map = new Map<string, string>();
    expiries.forEach((exp, i) => map.set(exp, palette[i % palette.length]));
    return map;
  }, [expiries]);

  /** In the fair-value view the legend picks the one expiry the chart shows. */
  const selectFairExpiry = (expiry: string) => {
    setFairExpiry(expiry);
    setHiddenExpiries((prev) => {
      if (!prev.has(expiry)) return prev;
      const next = new Set(prev);
      next.delete(expiry);
      return next;
    });
  };

  const toggleExpiryVisibility = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const isHidden = prev.has(expiry);
      const visibleCount = tableExpiries.filter((exp) => !prev.has(exp)).length;
      if (!isHidden && visibleCount <= 1) return prev;

      const next = new Set(prev);
      if (isHidden) {
        next.delete(expiry);
      } else {
        next.add(expiry);
      }
      return next;
    });
  };

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
            <span>Instrument</span>
            <AppSelect
              value={scrip}
              options={scripOptions}
              onChange={(v) => selectScrip(String(v))}
              searchable
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            <span>Expiry month</span>
            <AppSelect
              value={selectedExpiryMonth}
              options={selectableExpiryMonthOptions.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onChange={(v) => setSelectedExpiryMonth(String(v))}
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            <span>Strikes</span>
            <AppSelect
              value={strikeRange}
              options={[
                { value: 5, label: '5' },
                { value: 10, label: '10' },
                { value: 20, label: '20' },
                { value: 0, label: 'All' },
                { value: -1, label: 'Specific' },
              ]}
              onChange={(v) => { const val = Number(v); setStrikeRange(val); localStorage.setItem('optiontrap_strike_range', String(val)); }}
            />
          </label>

          {strikeRange === -1 && (
            <label className="oi-history__label">
              <input
                className="app-input oi-history__specific-strike"
                type="number"
                min="0"
                step="50"
                placeholder="Strike"
                value={specificStrike}
                onChange={(event) => {
                  setSpecificStrike(event.target.value);
                  localStorage.setItem('optiontrap_specific_strike', event.target.value);
                }}
                disabled={fetching}
              />
            </label>
          )}

          <div className="oi-history__primary-actions">
            <button
              className="app-btn app-btn--primary"
              onClick={handleFetch}
              disabled={fetching}
              title={fetchableExpiryMonths.length > 0
                ? `Fetch ${scrip} data for ${fetchableExpiryMonths.length} current/future expiry month(s) (${fetchableExpiryMonths.join(', ')}) from Kite`
                : 'Historical expiry months are loaded from stored database data'}
            >
              {fetching ? 'Fetching...' : 'Fetch'}
            </button>

            <div className="oi-history__data-menu" ref={dataMenuRef}>
              <button
                type="button"
                className="app-btn app-btn--secondary oi-history__data-menu-trigger"
                onClick={() => setIsDataMenuOpen((open) => !open)}
                aria-expanded={isDataMenuOpen}
                aria-haspopup="menu"
                title="Manage stored OI history data"
              >
                Data
              </button>
              {isDataMenuOpen && (
              <div className="oi-history__data-menu-panel" role="menu">
                <button
                  className="oi-history__data-menu-item"
                  onClick={() => { setIsDataMenuOpen(false); setConfirmCleanOld(true); }}
                  disabled={fetching}
                  role="menuitem"
                  title={`Delete ${scrip} OI history older than ${cleanupCutoffLabel}. Keeps ${cleanupCutoffLabel} and newer.`}
                >
                  <strong>Clean Old</strong>
                  <span>Keep {cleanupCutoffLabel} and newer</span>
                </button>
                <button
                  className="oi-history__data-menu-item oi-history__data-menu-item--danger"
                  onClick={() => { setIsDataMenuOpen(false); setConfirmDelete(true); }}
                  disabled={fetching}
                  role="menuitem"
                  title={`Delete all OI history data for ${scrip}`}
                >
                  <strong>Delete All</strong>
                  <span>Remove all stored months for {scrip}</span>
                </button>
              </div>
              )}
            </div>
          </div>

        </div>

        {recentScripOptions.length > 0 && (
          <div className="oi-history__recent-scrips" aria-label="Recently visited scripts">
            <span className="oi-history__recent-scrips-label">Recent</span>
            {recentScripOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="oi-history__recent-scrip"
                onClick={() => selectScrip(option.value)}
                disabled={fetching}
                title={`Switch to ${option.label}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

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

      {/* Date filter — grouped by month */}
      {visibleDates.length > 0 && (
        <div className="oi-history__date-bar">
          {datesByMonth.map(({ month, dates }) => (
            <div key={month} className="oi-history__date-group">
              <span className="oi-history__date-group-label">{formatMonthShortLabel(month)}</span>
              <div className="oi-history__date-group-days">
                {dates.map((d) => {
                  const isExpiryDay = expiryMarkerDates.has(d);
                  return (
                    <button
                      key={d}
                      className={`oi-history__date-btn ${filterDate === d ? 'oi-history__date-btn--active' : ''} ${isExpiryDay ? 'oi-history__date-btn--weekly-expiry' : ''}`}
                      onClick={() => setFilterDate(d)}
                      title={`${formatFullDateLabel(d)}${isExpiryDay ? ' — Expiry day' : ''}`}
                    >
                      {Number(d.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <FuturesContext futuresData={futuresData} filterDate={filterDate} scrip={scrip} />

      {/* Loading indicator */}
      {(loading || fetching) && data.length === 0 && (
        <div className="card oi-history__loading-card">
          <div className="oi-history__loading-spinner" />
          <span className="oi-history__loading-text">Loading data...</span>
        </div>
      )}

      {/* Expiry-pivoted table */}
      {tableData.length > 0 && (
        <OiSnapshotTable
          rows={tableData}
          expiries={visibleTableExpiries}
          isMonthlyExpiry={isMonthlyExpiry}
          filterDate={filterDate}
          atmStrike={atmStrike}
          spotClose={selectedSpotClose}
          maxConsolidatedOi={maxConsolidatedOi}
          flowByToken={flowByToken}
          selectedStrike={selectedStrike}
          onSelectStrike={setSelectedStrike}
          onTrade={handleTrade}
        />
      )}

      {/* Dual-axis chart for selected strike */}
      {chartData && selectedStrike && (
        <div className="oi-history__chart-wrap card">
          <div className="oi-history__chart-header">
            <span className="oi-history__chart-title">Strike {selectedStrike}</span>
            <div className="oi-history__chart-controls">
              <div className="oi-history__analysis-tabs" role="tablist" aria-label="OI analysis view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={analysisTab === 'history'}
                  className={`oi-history__analysis-tab ${analysisTab === 'history' ? 'oi-history__analysis-tab--active' : ''}`}
                  onClick={() => setAnalysisTab('history')}
                >
                  OI Price History
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={analysisTab === 'setup'}
                  className={`oi-history__analysis-tab ${analysisTab === 'setup' ? 'oi-history__analysis-tab--active' : ''}`}
                  onClick={() => setAnalysisTab('setup')}
                >
                  Trade Setup
                </button>
              </div>
            </div>
          </div>

          {analysisTab === 'history' && (
            <>
          <div className="oi-history__chart-pair">
            <StrikeOiChart optionType="CE" dates={chartData.dates} dateMap={chartData.dateMap} maxOi={chartData.maxOi} maxPrice={chartData.maxCePrice} expiries={chartExpiries} expiryColors={expiryColors} showVolume={showVolume} showFair={chartFairExpiry !== null} />
            <StrikeOiChart optionType="PE" dates={chartData.dates} dateMap={chartData.dateMap} maxOi={chartData.maxOi} maxPrice={chartData.maxPePrice} expiries={chartExpiries} expiryColors={expiryColors} showVolume={showVolume} showFair={chartFairExpiry !== null} />
          </div>

          {/* Legend: toggles expiries, or picks the single expiry in the fair-value view */}
          <div className="oi-history__chart-legend">
            {tableExpiries.map((exp) => {
              const label = expiryLabel(exp, isMonthlyExpiry(exp));
              const isOff = chartFairExpiry !== null ? exp !== chartFairExpiry : hiddenExpiries.has(exp);
              return (
              <button
                key={exp}
                type="button"
                className={`oi-history__chart-legend-item ${isOff ? 'oi-history__chart-legend-item--hidden' : ''}`}
                onClick={() => (chartFairExpiry !== null ? selectFairExpiry(exp) : toggleExpiryVisibility(exp))}
                aria-pressed={!isOff}
                title={chartFairExpiry !== null ? `Show fair value for ${label}` : `${isOff ? 'Show' : 'Hide'} ${label} in table and chart`}
              >
                <span className="oi-history__chart-legend-swatch" style={{ background: expiryColors.get(exp) }} />
                {label}
              </button>
              );
            })}
            {chartFairExpiry === null && (
              <span className="oi-history__chart-legend-item">
                <span className="oi-history__chart-legend-bar" /> {showVolume ? 'Volume' : 'OI'}
              </span>
            )}
            {chartFairExpiry !== null && (
              <>
                <span className="oi-history__chart-legend-item">
                  <span className="oi-history__chart-legend-dash" /> Fair value
                </span>
                <span className="oi-history__chart-legend-item">
                  <span className="oi-history__chart-legend-tick oi-history__chart-legend-tick--rich" /> Expensive
                </span>
                <span className="oi-history__chart-legend-item">
                  <span className="oi-history__chart-legend-tick oi-history__chart-legend-tick--cheap" /> Cheap
                </span>
              </>
            )}
          </div>
          <div className="oi-history__chart-metric-row">
            {/* In the fair-value view the bars show rich / cheap %, so the bar metric does not apply */}
            {!showFairValue && (
              <div className="oi-history__metric-toggle" role="group" aria-label="Chart bar metric">
                <button type="button" className={`oi-history__volume-toggle ${!showVolume ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowVolume(false)} aria-pressed={!showVolume}>OI</button>
                <button type="button" className={`oi-history__volume-toggle ${showVolume ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowVolume(true)} aria-pressed={showVolume}>Volume</button>
              </div>
            )}
            <div className="oi-history__metric-toggle" role="group" aria-label="Chart view">
              <button type="button" className={`oi-history__volume-toggle ${!showFairValue ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowFairValue(false)} aria-pressed={!showFairValue}>All expiries</button>
              <button type="button" className={`oi-history__volume-toggle ${showFairValue ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowFairValue(true)} aria-pressed={showFairValue} title="Show one expiry with its fair value from the IV curve">Fair value</button>
            </div>
          </div>
          {chartFairExpiry !== null && fairSummary && (
            <div className="oi-history__fair-summary">
              <span className="oi-history__fair-stat">
                <span>ATM IV</span>
                <strong>{fairSummary.stats?.atmIv != null ? `${(fairSummary.stats.atmIv * 100).toFixed(1)}%` : '-'}</strong>
              </span>
              <span className="oi-history__fair-stat">
                <span>Realised ({REALIZED_WINDOW}d)</span>
                <strong>{fairSummary.realized !== null ? `${(fairSummary.realized * 100).toFixed(1)}%` : '-'}</strong>
              </span>
              {fairSummary.verdict && (
                <span className={`oi-history__fair-verdict oi-history__fair-verdict--${fairSummary.verdict === 'Options expensive' ? 'rich' : fairSummary.verdict === 'Options cheap' ? 'cheap' : 'fair'}`}>
                  {fairSummary.verdict}
                </span>
              )}
              <span className="oi-history__fair-stat">
                <span>Expected move</span>
                <strong>
                  {fairSummary.stats?.straddle != null
                    ? `±${Math.round(fairSummary.stats.straddle)}${fairSummary.spot ? ` (${((fairSummary.stats.straddle / fairSummary.spot) * 100).toFixed(1)}%)` : ''}`
                    : '-'}
                </strong>
              </span>
              <span className="oi-history__fair-note">
                Grey line = price at the expiry&apos;s fitted IV curve; the gap to the price is shaded. Above it is expensive, below is cheap.
              </span>
            </div>
          )}
            </>
          )}

          {analysisTab === 'setup' && (
            <TradeSetupDashboard
              setup={chartData}
              selectedStrike={selectedStrike}
              filterDate={filterDate}
              expiries={visibleTableExpiries}
              isMonthlyExpiry={isMonthlyExpiry}
              signalPerformance={signalPerformance}
              onTrade={tradeFromSetup}
              signalRows={signalRows}
              onDeleteSignal={deleteSignal}
            />
          )}
        </div>
      )}

      {data.length === 0 && !loading && !fetching && (
        <div className="oi-history__empty card">
          Select an expiry month and click <strong>Fetch</strong> to download OI history up to today.
          Already-fetched trading days for that expiry month are skipped automatically.
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="oi-confirm-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="oi-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="oi-confirm-modal__title">Delete Script Data</h4>
            <p className="oi-confirm-modal__text">
              Delete ALL OI history data for <strong>{scripOptions.find((o) => o.value === scrip)?.label || scrip}</strong>? This cannot be undone.
            </p>
            <div className="oi-confirm-modal__actions">
              <button className="app-btn app-btn--secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="app-btn app-btn--danger" onClick={handleDeleteMonth}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Clean old confirmation modal */}
      {confirmCleanOld && (
        <div className="oi-confirm-overlay" onClick={() => setConfirmCleanOld(false)}>
          <div className="oi-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="oi-confirm-modal__title">Clean Old Data</h4>
            <p className="oi-confirm-modal__text">
              Delete OI history for <strong>{scripOptions.find((o) => o.value === scrip)?.label || scrip}</strong> with expiry months older than <strong>{cleanupCutoffLabel}</strong>?
            </p>
            <p className="oi-confirm-modal__text">
              This keeps {cleanupCutoffLabel} and newer data for current comparisons. This cannot be undone.
            </p>
            <div className="oi-confirm-modal__actions">
              <button className="app-btn app-btn--secondary" onClick={() => setConfirmCleanOld(false)}>Cancel</button>
              <button className="app-btn app-btn--danger" onClick={handleCleanOld}>Clean Old Data</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OiHistory;
