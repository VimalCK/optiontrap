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
import type { OiHistoryRow, FuturesHistoryRow, FetchProgress, SignalPerformanceSummary, RolloverPattern, TradeSetupStatus, StrikeHistoryEntry } from './types';
import { DEFAULT_SCRIP_OPTIONS, MAX_RECENT_SCRIPS, loadRecentScrips, saveRecentScrips, formatOiCompact, formatOiWithChg, currentMonthIST, addMonths, FUTURES_LINE_COLORS, buildFuturesSeries, formatMonthLabel, formatMonthShortLabel, formatFullDateLabel, formatPct, formatPcr } from './helpers';
import { summarizePriceTrend, summarizeTradeBias, checklistStatusText, sortChecklistByStatus, readinessScore, setupReadinessLabel, setupReadinessWidth, summarizeTradeLevels, summarizeOptionMomentum, summarizeTradeSetup, summarizePremiumDecay, summarizeSellingSetup, summarizeStrikeBias, classifyPattern, patternColor, expiryLabel, computeMonthlyExpiries } from './analysis';
import { ChartXAxis } from './ChartXAxis';

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
  const [showPatternInfo, setShowPatternInfo] = useState(false);
  const [showFuturesInfo, setShowFuturesInfo] = useState(false);
  const [futuresView, setFuturesView] = useState<'table' | 'chart'>('table');
  const [futuresHover, setFuturesHover] = useState<{ date: string; x: number; oi: number; volume: number; closes: { label: string; color: string; close: number }[] } | null>(null);
  const [analysisTab, setAnalysisTab] = useState<'history' | 'setup'>('history');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [signalPerformance, setSignalPerformance] = useState<SignalPerformanceSummary | null>(null);
  const [outcomeRefreshVersion, setOutcomeRefreshVersion] = useState(0);
  const loggedSignalKeysRef = useRef(new Set<string>());
  // Scrip the loaded `data` belongs to. Right after a scrip switch, `scrip` is
  // already new while `data` still holds the previous scrip's rows.
  const [dataScrip, setDataScrip] = useState('');
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(() => new Set());
  const [showVolume, setShowVolume] = useState(false);
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
      }) as {
        strike: number;
        cells: Map<string, CellData>;
        cePattern: RolloverPattern;
        pePattern: RolloverPattern;
        ceConsolidatedOi: number;
        peConsolidatedOi: number;
        dimmed: boolean;
      }[];

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
      if (r.optionType === 'CE') {
        entry.ceOi = r.oi;
        entry.ceClose = r.close;
        entry.ceVolume = r.volume;
      } else {
        entry.peOi = r.oi;
        entry.peClose = r.close;
        entry.peVolume = r.volume;
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

    return { dates, dateMap, maxOi, maxCePrice, maxPePrice, biasSummary, priceTrend, tradeBias, tradeSetup, tradeLevels, optionMomentum, premiumDecay, sellingSetup };
  }, [data, selectedStrike, availableDates, visibleTableExpiries, selectedSpotClose, tableData]);

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
    const key = `${scrip}|${signalDate}|${expiry}|${selectedStrike}|${optionType}|${action}`;
    if (loggedSignalKeysRef.current.has(key)) return;
    loggedSignalKeysRef.current.add(key);

    void apiClient.post('/api/oi-history/signals', {
        scrip,
        signalDate,
        expiry,
        strike: selectedStrike,
        optionType,
        action,
        status: setupStatus,
        entryPremium: side?.latestClose ?? null,
        spotPrice: chartData.priceTrend.endPrice ?? null,
        details: {
          priceTrend: chartData.priceTrend,
          sellingType: selling.type,
          sellingStatus: selling.status,
          buyingDirection: buying.direction,
          buyingStatus: buying.status,
          buyingMomentum: optionType === 'CE' ? chartData.optionMomentum.ce : chartData.optionMomentum.pe,
          decay: side ? { decayPct: side.decayPct, score: side.score, daysToExpiry: side.daysToExpiry, latestVolume: side.latestVolume } : null,
        },
      },
    ).catch(() => {
      // Logging must never affect the Trade Setup UI.
    });
  }, [chartData, scrip, dataScrip, selectedStrike]);

  // Refresh outcomes for older signals whenever a newer session is visible.
  // This gives the research log a simple mark-to-market result without
  // pretending that an order was actually executed.
  useEffect(() => {
    if (!chartData || chartData.dates.length === 0 || !selectedStrike || dataScrip !== scrip) return;
    const latestDate = chartData.dates[chartData.dates.length - 1];
    const availableExpiries = new Set(visibleTableExpiries);
    if (availableExpiries.size === 0) return;

    void (async () => {
      try {
        const result = await apiClient.get<{ signals?: Array<{
          id: number; signal_date: string; expiry: string | null; strike: number; option_type: 'CE' | 'PE';
          action: 'BUY' | 'SELL'; entry_premium: number | null; outcome_status: string | null; outcome_final: boolean;
        }> }>(`/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=200`, { signal: pageSignal });
        let outcomesUpdated = false;
        for (const signal of result.signals || []) {
          if (signal.outcome_final || signal.signal_date > latestDate || !signal.expiry || !availableExpiries.has(signal.expiry) || signal.strike !== selectedStrike) continue;
          if (!signal.entry_premium || signal.entry_premium <= 0) continue;
          const path = chartData.dates
            .filter((date) => date >= signal.signal_date)
            .map((date) => chartData.dateMap.get(date)?.get(signal.expiry!)?.[signal.option_type === 'CE' ? 'ceClose' : 'peClose'] || 0)
            .filter((price) => price > 0);
          // The first price is the entry day itself; without a later price there
          // is nothing to measure, so don't record a flat 0% (which read as a Loss).
          if (path.length < 2) continue;
          const returns = path.map((price) => {
            const raw = ((price - signal.entry_premium!) / signal.entry_premium!) * 100;
            return signal.action === 'SELL' ? -raw : raw;
          });
          const returnPct = returns[returns.length - 1];
          const final = latestDate >= signal.expiry;
          await apiClient.patch(`/api/oi-history/signals/${signal.id}/outcome`, {
              price: path[path.length - 1],
              date: latestDate,
              returnPct,
              maxFavorableReturn: Math.max(...returns),
              maxAdverseReturn: Math.min(...returns),
              final,
              status: final ? (returnPct > 0 ? 'Profit' : 'Loss') : 'Open',
          }, { signal: pageSignal });
          outcomesUpdated = true;
        }
        if (outcomesUpdated) setOutcomeRefreshVersion((version) => version + 1);
      } catch {
        // Outcome tracking must never affect the Trade Setup UI.
      }
    })();
  }, [chartData, scrip, dataScrip, selectedStrike, visibleTableExpiries, pageSignal]);

  useEffect(() => {
    if (!chartData || !scrip) return;
    void (async () => {
      try {
        const result = await apiClient.get<{
          signals?: Array<{ action: 'BUY' | 'SELL'; option_type: 'CE' | 'PE'; outcome_status: string | null; outcome_return: number | null; max_favorable_return: number | null; max_adverse_return: number | null }>;
        }>(`/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=500`, { signal: pageSignal });
        const signals = result.signals || [];
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
        const optionBreakdown = (['BUY CE', 'BUY PE', 'SELL CE', 'SELL PE'] as const).map((label) => {
          const [action, optionType] = label.split(' ') as ['BUY' | 'SELL', 'CE' | 'PE'];
          const rows = evaluated.filter((signal) => signal.action === action && signal.option_type === optionType);
          const rowWins = rows.filter((signal) => signal.outcome_status === 'Profit').length;
          return {
            label,
            evaluated: rows.length,
            winRate: rows.length ? (rowWins / rows.length) * 100 : null,
            averageReturn: rows.length ? rows.reduce((sum, signal) => sum + Number(signal.outcome_return || 0), 0) / rows.length : null,
          };
        });
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
          optionBreakdown,
        });
      } catch {
        // Research metrics are optional and must never block the setup.
      }
    })();
  }, [chartData, scrip, outcomeRefreshVersion, pageSignal]);

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

  const exportSignalResults = useCallback(async () => {
    try {
      const result = await apiClient.get<{ signals?: Array<Record<string, unknown>> }>(`/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=500`);
      const signals = result.signals || [];
      const columns = ['signal_date', 'scrip', 'expiry', 'strike', 'option_type', 'action', 'status', 'entry_premium', 'spot_price', 'outcome_status', 'outcome_date', 'outcome_return', 'max_favorable_return', 'max_adverse_return', 'outcome_final'];
      const numericColumns = new Set(['strike', 'entry_premium', 'spot_price', 'outcome_return', 'max_favorable_return', 'max_adverse_return']);
      // Loaded on demand so the spreadsheet library stays out of the page bundle.
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Trade signals');
      sheet.columns = columns.map((column) => ({ header: column, key: column, width: Math.max(column.length + 2, 12) }));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      for (const signal of signals) {
        const row = sheet.addRow(Object.fromEntries(columns.map((column) => {
          const value = signal[column];
          if (value === null || value === undefined || value === '') return [column, null];
          return [column, numericColumns.has(column) && Number.isFinite(Number(value)) ? Number(value) : String(value)];
        })));
        // Light red for losses, light green for profits.
        const fill = signal.outcome_status === 'Loss' ? 'FFFDE2E2' : signal.outcome_status === 'Profit' ? 'FFDCFCE7' : null;
        if (fill) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `optiontrap-${scrip.toLowerCase()}-trade-signals.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Export is optional and must not affect the setup UI.
    }
  }, [scrip]);

  /** Futures contracts loaded for M-1 (if stored) and the current-through-selected month range, oldest first. */
  const futuresContracts = useMemo(() => {
    const contracts = new Map<string, string>();
    for (const row of futuresData) {
      if (row.expiry && !contracts.has(row.expiry)) contracts.set(row.expiry, row.tradingsymbol);
    }
    return [...contracts].map(([expiry, tradingsymbol]) => ({ expiry, tradingsymbol })).sort((a, b) => a.expiry.localeCompare(b.expiry));
  }, [futuresData]);

  // Changes are computed within each contract so rollover days don't show false jumps.
  const futuresRowsByContract = useMemo(() => {
    const byContract = new Map<string, ReturnType<typeof buildFuturesSeries>>();
    for (const { expiry } of futuresContracts) {
      byContract.set(expiry, buildFuturesSeries(futuresData.filter((row) => row.expiry === expiry)));
    }
    return byContract;
  }, [futuresData, futuresContracts]);

  /** Table view shows every contract on the selected date, like the OI Snapshot. */
  const futuresDateRows = useMemo(() => {
    return futuresContracts
      .map(({ expiry }) => futuresRowsByContract.get(expiry)?.find((row) => row.date === filterDate))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [futuresContracts, futuresRowsByContract, filterDate]);

  /** Chart view plots every month's price on a shared date axis; bars are total OI/volume across months. */
  const futuresChart = useMemo(() => {
    const dates = [...new Set(futuresData.map((row) => row.date))].sort();
    if (dates.length === 0) return null;
    const prices = futuresData.map((row) => row.close).filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || Math.max(max * 0.01, 1);
    const padding = range * 0.12;
    const low = min - padding;
    const high = max + padding;
    const left = 50;
    const right = 50;
    const top = 16;
    const bottom = 30;
    const width = 700;
    const height = 162;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const stepX = plotWidth / dates.length;
    const xByDate = new Map(dates.map((date, index) => [date, left + (index + 0.5) * stepX]));
    const toY = (close: number) => top + ((high - close) / (high - low)) * plotHeight;
    const lines = futuresContracts.map(({ expiry, tradingsymbol }, index) => ({
      expiry,
      tradingsymbol,
      label: formatMonthLabel(expiry.slice(0, 7)),
      color: FUTURES_LINE_COLORS[index % FUTURES_LINE_COLORS.length],
      points: (futuresRowsByContract.get(expiry) || [])
        .filter((row) => row.close > 0)
        .map((row) => ({ date: row.date, close: row.close, x: xByDate.get(row.date)!, y: toY(row.close) })),
    }));
    const days = dates.map((date) => {
      const rows = futuresData.filter((row) => row.date === date);
      return {
        date,
        x: xByDate.get(date)!,
        oi: rows.reduce((sum, row) => sum + (row.oi || 0), 0),
        volume: rows.reduce((sum, row) => sum + (row.volume || 0), 0),
        closes: lines.flatMap((line) => {
          const point = line.points.find((item) => item.date === date);
          return point ? [{ label: line.label, color: line.color, close: point.close }] : [];
        }),
      };
    });
    const maxOi = Math.max(1, ...days.map((day) => day.oi));
    const maxVolume = Math.max(1, ...days.map((day) => day.volume));
    return { lines, days, low, high, left, right, top, bottom, width, height, plotWidth, plotHeight, maxOi, maxVolume };
  }, [futuresData, futuresContracts, futuresRowsByContract]);

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

      {futuresContracts.length > 0 && (
        <div className="oi-history__table-wrap card" style={{ marginBottom: 16 }}>
          <div className="oi-history__table-header">
            <div className="oi-history__table-header-left">
              <div>
                <div className="oi-history__table-title">Futures Context</div>
                <div className="oi-history__table-subtitle">
                  {futuresView === 'chart'
                    ? `${futuresContracts.length} month${futuresContracts.length === 1 ? '' : 's'} · Daily price, OI, and volume history`
                    : <>{filterDate ? formatFullDateLabel(filterDate) : 'Select a date'}<span>Daily price, OI, and volume confirmation</span></>}
                </div>
              </div>
            </div>
            <div className="oi-history__table-meta">
              <div className="oi-history__metric-toggle" role="group" aria-label="Futures view">
                <button type="button" className={`oi-history__volume-toggle ${futuresView === 'table' ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setFuturesView('table')} aria-pressed={futuresView === 'table'}>Table</button>
                <button type="button" className={`oi-history__volume-toggle ${futuresView === 'chart' ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setFuturesView('chart')} aria-pressed={futuresView === 'chart'}>Chart</button>
              </div>
              <button
                type="button"
                className="app-btn app-btn--icon oi-history__futures-info-button"
                onClick={() => setShowFuturesInfo((visible) => !visible)}
                title="Explain futures signals"
                aria-label="Explain futures signals"
                aria-expanded={showFuturesInfo}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>
          {showFuturesInfo && (
            <div className="oi-history__futures-info" role="note">
              <div className="oi-history__futures-info-title">How futures signals are calculated</div>
              <div className="oi-history__futures-info-grid">
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bullish">
                  <strong>Long buildup</strong>
                  <span>Price ↑ and OI ↑</span>
                  <small>New buyers are entering. Generally bullish.</small>
                </div>
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bearish">
                  <strong>Short buildup</strong>
                  <span>Price ↓ and OI ↑</span>
                  <small>New sellers are entering. Generally bearish.</small>
                </div>
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bearish">
                  <strong>Long unwinding</strong>
                  <span>Price ↓ and OI ↓</span>
                  <small>Existing buyers are closing positions. Signals weakness.</small>
                </div>
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bullish">
                  <strong>Short covering</strong>
                  <span>Price ↑ and OI ↓</span>
                  <small>Existing sellers are closing positions. Can support a rebound.</small>
                </div>
              </div>
              <div className="oi-history__futures-volume-note">
                <strong>Active volume:</strong> today’s volume is at least the average of the previous five trading days. This indicates stronger participation, not direction by itself.
              </div>
            </div>
          )}
          {futuresView === 'chart' && futuresChart ? (
            <div className="oi-history__chart-wrap oi-history__chart-wrap--futures">
              <div className="oi-history__chart-header">
                <div className="oi-history__chart-title">Futures Price History</div>
              </div>
              <svg className="oi-history__chart-svg" viewBox={`0 0 ${futuresChart.width} ${futuresChart.height}`} role="img" aria-label={`${scrip} futures price chart by month`}>
                {[0, 0.5, 1].map((fraction) => {
                  const y = futuresChart.top + fraction * futuresChart.plotHeight;
                  const value = futuresChart.high - fraction * (futuresChart.high - futuresChart.low);
                  return (
                    <g key={fraction}>
                      <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={y} y2={y} stroke="var(--card-border)" strokeWidth="0.5" />
                      <text x={futuresChart.left - 4} y={y + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">{value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</text>
                    </g>
                  );
                })}
                <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={futuresChart.top + futuresChart.plotHeight} y2={futuresChart.top + futuresChart.plotHeight} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />
                <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={futuresChart.top + futuresChart.plotHeight} y2={futuresChart.top + futuresChart.plotHeight} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />
                {futuresChart.days.map((day) => {
                  const slotWidth = futuresChart.plotWidth / futuresChart.days.length;
                  const barWidth = Math.min(slotWidth * 0.32, 6);
                  const oiHeight = (day.oi / futuresChart.maxOi) * futuresChart.plotHeight;
                  const volumeHeight = (day.volume / futuresChart.maxVolume) * futuresChart.plotHeight;
                  return (
                    <g key={`bars-${day.date}`} onMouseEnter={() => setFuturesHover(day)} onMouseLeave={() => setFuturesHover(null)}>
                      <rect x={day.x - barWidth} y={futuresChart.top + futuresChart.plotHeight - oiHeight} width={Math.max(barWidth, 0.5)} height={oiHeight} fill="#8b5cf6" opacity="0.45" rx="1">
                        <title>{`${formatFullDateLabel(day.date)} Total OI: ${formatOiCompact(day.oi)}`}</title>
                      </rect>
                      <rect x={day.x} y={futuresChart.top + futuresChart.plotHeight - volumeHeight} width={Math.max(barWidth, 0.5)} height={volumeHeight} fill="#06b6d4" opacity="0.45" rx="1">
                        <title>{`${formatFullDateLabel(day.date)} Total volume: ${formatOiCompact(day.volume)}`}</title>
                      </rect>
                    </g>
                  );
                })}
                {futuresChart.lines.map((line) => (
                  <g key={`line-${line.expiry}`}>
                    <polyline points={line.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={line.color} strokeWidth="1.2" strokeLinejoin="round" />
                    {line.points.map((point) => (
                      <circle key={point.date} cx={point.x} cy={point.y} r="2.5" fill={line.color} onMouseEnter={() => setFuturesHover(futuresChart.days.find((day) => day.date === point.date) || null)} onMouseLeave={() => setFuturesHover(null)}>
                        <title>{`${line.label} · ${formatFullDateLabel(point.date)}: ${point.close.toLocaleString('en-IN')}`}</title>
                      </circle>
                    ))}
                  </g>
                ))}
                {futuresHover && (() => {
                  const tooltipWidth = 150;
                  const tooltipHeight = 28 + futuresHover.closes.length * 12;
                  const tooltipX = Math.min(Math.max(futuresHover.x - tooltipWidth / 2, futuresChart.left), futuresChart.width - futuresChart.right - tooltipWidth);
                  return (
                    <g pointerEvents="none">
                      <rect x={tooltipX} y={futuresChart.top + 3} width={tooltipWidth} height={tooltipHeight} rx="3" fill="var(--card-bg-solid, #111827)" stroke="var(--card-border)" />
                      <text x={tooltipX + 7} y={futuresChart.top + 14} fontSize="8" fill="var(--text-primary)">{formatFullDateLabel(futuresHover.date)}</text>
                      {futuresHover.closes.map((item, index) => (
                        <text key={item.label} x={tooltipX + 7} y={futuresChart.top + 26 + index * 12} fontSize="8" fill={item.color}>{item.label}: {item.close.toLocaleString('en-IN')}</text>
                      ))}
                      <text x={tooltipX + 7} y={futuresChart.top + 26 + futuresHover.closes.length * 12} fontSize="8" fill="var(--text-secondary)">Total OI: {formatOiCompact(futuresHover.oi)} · Vol: {formatOiCompact(futuresHover.volume)}</text>
                    </g>
                  );
                })()}
                <ChartXAxis dates={futuresChart.days.map((day) => day.date)} padL={futuresChart.left} plotW={futuresChart.plotWidth} h={futuresChart.height} />
              </svg>
              <div className="oi-history__chart-legend">
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-swatch" style={{ background: '#8b5cf6' }} /> Total OI</span>
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-swatch" style={{ background: '#06b6d4' }} /> Total volume</span>
                {futuresChart.lines.map((line) => (
                  <span key={line.expiry} className="oi-history__chart-legend-item" title={line.tradingsymbol}><span className="oi-history__chart-legend-swatch" style={{ background: line.color }} /> {line.label}</span>
                ))}
              </div>
            </div>
          ) : futuresDateRows.length === 0 ? (
            <div className="oi-history__status">No futures data for {filterDate ? formatFullDateLabel(filterDate) : 'the selected date'}.</div>
          ) : (
          <div className="oi-history__table-scroll">
            <table className="oi-history__table oi-history__futures-table">
              <thead><tr>
                <th className="oi-history__futures-th--date">Month</th>
                <th className="oi-history__futures-th--price">Close</th>
                <th className="oi-history__futures-th--price">Price</th>
                <th className="oi-history__futures-th--oi">OI</th>
                <th className="oi-history__futures-th--oi">OI change</th>
                <th className="oi-history__futures-th--volume">Volume</th>
                <th className="oi-history__futures-th--signal">Signal</th>
              </tr></thead>
              <tbody>{futuresDateRows.map((row) => (
                <tr key={row.expiry}>
                  <td className="oi-history__futures-date" title={row.tradingsymbol}>{formatMonthLabel(row.expiry.slice(0, 7))}</td>
                  <td className="oi-history__futures-close">{row.close?.toLocaleString('en-IN') || '-'}</td>
                  <td className={row.priceChangePct !== null && row.priceChangePct >= 0 ? 'oi-history__futures-positive' : 'oi-history__futures-negative'}>
                    <span className="oi-history__cell-primary">{row.priceChangePct === null ? '-' : `${row.priceChangePct >= 0 ? '+' : ''}${row.priceChangePct.toFixed(2)}%`}</span>
                  </td>
                  <td className="oi-history__futures-oi">{row.oi?.toLocaleString('en-IN') || '-'}</td>
                  <td className={row.oiChangePct !== null && row.oiChangePct >= 0 ? 'oi-history__futures-positive' : 'oi-history__futures-negative'}>
                    <span className="oi-history__cell-primary">{row.oiChangePct === null ? '-' : `${row.oiChangePct >= 0 ? '+' : ''}${row.oiChangePct.toFixed(2)}%`}</span>
                  </td>
                  <td className="oi-history__futures-volume">{row.volume?.toLocaleString('en-IN') || '-'}</td>
                  <td className={`oi-history__futures-signal ${row.interpretation === 'Long buildup' || row.interpretation === 'Short covering' ? 'oi-history__futures-signal--bullish' : row.interpretation === 'Short buildup' || row.interpretation === 'Long unwinding' ? 'oi-history__futures-signal--bearish' : ''}`}>
                    {row.interpretation}{row.avgVolume && row.volume >= row.avgVolume ? ' · active volume' : ''}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          )}
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
            <div className="oi-history__table-header-left">
              <div>
                <div className="oi-history__table-title">OI Snapshot</div>
                <div className="oi-history__table-subtitle">
                  {filterDate ? formatFullDateLabel(filterDate) : 'Select a date'}
                  <span>Daily change vs previous session</span>
                </div>
              </div>
            </div>
            <div className="oi-history__table-meta">
              <span className="oi-history__table-count">{tableData.length} strikes</span>
              <span className="oi-history__table-count">{visibleTableExpiries.length} expiries</span>
              <button
                type="button"
                className="app-btn app-btn--icon oi-history__pattern-info-button"
                onClick={() => setShowPatternInfo((visible) => !visible)}
                title="Explain OI Snapshot patterns"
                aria-label="Explain OI Snapshot patterns"
                aria-expanded={showPatternInfo}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>

        {showPatternInfo && (
          <div className="trap-info-detail" style={{ marginBottom: 12 }}>
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
              <li><strong style={{ color: '#22c55e' }}>Doubling Down (Long)</strong> — OI rising across multiple expiries while option price is rising. Buyers are adding conviction across expiries.</li>
              <li><strong style={{ color: '#ef4444' }}>Doubling Down (Short)</strong> — OI rising across multiple expiries while option price is falling. Sellers are adding conviction across expiries.</li>
              <li><strong style={{ color: '#ef4444' }}>Unwinding</strong> — OI falling across all expiries because existing positions are being closed. No meaningful new positions are replacing them.</li>
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

          <div className="oi-history__table-scroll">
            <table className="oi-history__table">
              <thead>
                <tr>
                  <th className="oi-history__th-pattern">CE Pattern</th>
                  {visibleTableExpiries.map((exp) => (
                    <th key={`ce-${exp}`} className="oi-history__th-group oi-history__th-group--ce">
                      {expiryLabel(exp, isMonthlyExpiry(exp))}
                    </th>
                  ))}
                  <th className="oi-history__th-strike">Strike</th>
                  {visibleTableExpiries.map((exp) => (
                    <th key={`pe-${exp}`} className="oi-history__th-group oi-history__th-group--pe">
                      {expiryLabel(exp, isMonthlyExpiry(exp))}
                    </th>
                  ))}
                  <th className="oi-history__th-pattern">PE Pattern</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map(({ strike, cells, cePattern, pePattern, ceConsolidatedOi, peConsolidatedOi, dimmed }) => {
                  const isAtm = strike === atmStrike;
                  const isCeItm = selectedSpotClose !== null && selectedSpotClose > 0 && strike < selectedSpotClose;
                  const isPeItm = selectedSpotClose !== null && selectedSpotClose > 0 && strike > selectedSpotClose;
                  const ceBarWidth = maxConsolidatedOi > 0 ? (ceConsolidatedOi / maxConsolidatedOi) * 50 : 0;
                  const peBarWidth = maxConsolidatedOi > 0 ? (peConsolidatedOi / maxConsolidatedOi) * 50 : 0;
                  return (
                    <tr
                      key={strike}
                      className={`${isAtm ? 'oi-history__row--atm' : ''} ${selectedStrike === strike ? 'oi-history__row--selected' : ''} ${dimmed ? 'oi-history__row--dimmed' : ''}`}
                      onClick={() => setSelectedStrike(strike)}
                    >
                      {/* CE Pattern */}
                      <td
                        className="oi-history__cell--pattern oi-history__cell--pattern-ce"
                        style={{ color: patternColor(cePattern) }}
                        title={`CE pattern: ${cePattern}`}
                      >
                        {cePattern}
                      </td>

                      {/* CE data per expiry */}
                      {visibleTableExpiries.map((exp) => {
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
                      <td className={`oi-history__cell--strike ${isAtm ? 'oi-history__cell--strike-atm' : ''}`} title={isAtm ? 'At-the-money strike' : `Strike ${strike}`}>
                        <div className="oi-history__strike-bars" style={{ '--oi-history-expiry-count': visibleTableExpiries.length } as React.CSSProperties}>
                          <div className="oi-history__oi-bar oi-history__oi-bar--ce" style={{ width: `${ceBarWidth}%` }} />
                          <div className="oi-history__oi-bar oi-history__oi-bar--pe" style={{ width: `${peBarWidth}%` }} />
                        </div>
                        {strike}
                      </td>

                      {/* PE data per expiry */}
                      {visibleTableExpiries.map((exp) => {
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
                        className="oi-history__cell--pattern oi-history__cell--pattern-pe"
                        style={{ color: patternColor(pePattern) }}
                        title={`PE pattern: ${pePattern}`}
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
            {/* CE Chart */}
            {(() => {
              const W = 700, H = 162, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 30;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxCePrice } = chartData;
              const maxBarValue = showVolume
                ? Math.max(1, ...dates.flatMap((date) => visibleTableExpiries.map((exp) => dateMap.get(date)?.get(exp)?.ceVolume || 0)))
                : maxOi;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const expiryCount = Math.max(1, visibleTableExpiries.length);
              const slotW = plotW / n;
              const barW = Math.min((slotW * 0.8) / expiryCount, 10);
              const safeMaxPrice = maxCePrice || 1;

              // Build price lines per expiry
              const priceLines = visibleTableExpiries.map((exp) => {
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
                      const expiryBars = visibleTableExpiries
                        .map((exp) => ({ exp, value: showVolume ? dateMap.get(d)?.get(exp)?.ceVolume || 0 : dateMap.get(d)?.get(exp)?.ceOi || 0 }))
                        .filter((b) => b.value > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.value / maxBarValue) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={Math.max(barW * 0.85, 0.5)} height={barH}
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
                            <circle cx={p.x} cy={p.y} r={1.5} fill={expiryColors.get(exp)} />
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

                    {/* Left axis labels (price) */}
                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
                        ₹{Math.round(safeMaxPrice * frac)}
                      </text>
                    ))}

                    {/* Right axis labels (OI) */}
                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
                        {formatOiCompact(Math.round(maxBarValue * frac))}
                      </text>
                    ))}

                    {/* X-axis: day numbers + month band */}
                    <ChartXAxis dates={dates} padL={PAD_L} plotW={plotW} h={H} />
                  </svg>
                </div>
              );
            })()}

            {/* PE Chart */}
            {(() => {
              const W = 700, H = 162, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 30;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxPePrice } = chartData;
              const maxBarValue = showVolume
                ? Math.max(1, ...dates.flatMap((date) => visibleTableExpiries.map((exp) => dateMap.get(date)?.get(exp)?.peVolume || 0)))
                : maxOi;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const expiryCount = Math.max(1, visibleTableExpiries.length);
              const slotW = plotW / n;
              const barW = Math.min((slotW * 0.8) / expiryCount, 10);
              const safeMaxPrice = maxPePrice || 1;

              const priceLines = visibleTableExpiries.map((exp) => {
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
                      const expiryBars = visibleTableExpiries
                        .map((exp) => ({ exp, value: showVolume ? dateMap.get(d)?.get(exp)?.peVolume || 0 : dateMap.get(d)?.get(exp)?.peOi || 0 }))
                        .filter((b) => b.value > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.value / maxBarValue) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={Math.max(barW * 0.85, 0.5)} height={barH}
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
                            <circle cx={p.x} cy={p.y} r={1.5} fill={expiryColors.get(exp)} />
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

                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
                        ₹{Math.round(safeMaxPrice * frac)}
                      </text>
                    ))}

                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
                        {formatOiCompact(Math.round(maxBarValue * frac))}
                      </text>
                    ))}

                    {/* X-axis: day numbers + month band */}
                    <ChartXAxis dates={dates} padL={PAD_L} plotW={plotW} h={H} />
                  </svg>
                </div>
              );
            })()}
          </div>

          {/* Legend */}
          <div className="oi-history__chart-legend">
            {tableExpiries.map((exp) => {
              const isHidden = hiddenExpiries.has(exp);
              return (
              <button
                key={exp}
                type="button"
                className={`oi-history__chart-legend-item ${isHidden ? 'oi-history__chart-legend-item--hidden' : ''}`}
                onClick={() => toggleExpiryVisibility(exp)}
                aria-pressed={!isHidden}
                title={`${isHidden ? 'Show' : 'Hide'} ${expiryLabel(exp, isMonthlyExpiry(exp))} in table and chart`}
              >
                <span className="oi-history__chart-legend-swatch" style={{ background: expiryColors.get(exp) }} />
                {expiryLabel(exp, isMonthlyExpiry(exp))}
              </button>
              );
            })}
            <span className="oi-history__chart-legend-item">
              <span className="oi-history__chart-legend-bar" /> OI
            </span>
          </div>
          <div className="oi-history__chart-metric-row">
            <div className="oi-history__metric-toggle" role="group" aria-label="Chart bar metric">
              <button type="button" className={`oi-history__volume-toggle ${!showVolume ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowVolume(false)} aria-pressed={!showVolume}>OI</button>
              <button type="button" className={`oi-history__volume-toggle ${showVolume ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowVolume(true)} aria-pressed={showVolume}>Volume</button>
            </div>
          </div>
            </>
          )}

          {analysisTab === 'setup' && (
            <div className={`oi-history__setup-dashboard oi-history__setup-dashboard--${chartData.tradeSetup.status.toLowerCase()}`}>
              <div className="oi-history__setup-titlebar">
                <div>
                  <span>TRADE SETUP</span>
                  <h3>Decision dashboard</h3>
                  <p>One view for buying momentum, selling decay, and the conditions that invalidate each idea.</p>
                </div>
                <div className="oi-history__setup-titlebar-meta">
                  <strong>{selectedStrike ?? '-'} STRIKE</strong>
                  <span>{filterDate} · {visibleTableExpiries.length} expiry{visibleTableExpiries.length === 1 ? '' : 'ies'}</span>
                </div>
              </div>
              <div className="oi-history__setup-choice-grid">
                <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${chartData.tradeSetup.status.toLowerCase()}`}>
                  <div className="oi-history__setup-mode-card-head">
                    <span>Option Buying Trade</span>
                    <strong>{chartData.tradeSetup.direction} {chartData.tradeSetup.status === 'Avoid' ? 'No Trade' : chartData.tradeSetup.status}</strong>
                  </div>
                  <div className="oi-history__readiness-meter">
                    <span>Buying setup</span>
                    <strong>{setupReadinessLabel(chartData.tradeSetup.status, readinessScore(chartData.tradeSetup.checklist))}</strong>
                    <div><span style={{ width: setupReadinessWidth(chartData.tradeSetup.status, readinessScore(chartData.tradeSetup.checklist)) }} /></div>
                  </div>
                  <p>{chartData.tradeSetup.action}</p>
                  <div className="oi-history__buying-summary">
                    <div className="oi-history__buying-summary-head">
                      <div>
                        <span>Nearest-expiry momentum</span>
                        <strong>{chartData.optionMomentum.nearestExpiry ? expiryLabel(chartData.optionMomentum.nearestExpiry, isMonthlyExpiry(chartData.optionMomentum.nearestExpiry)) : 'Unavailable'}</strong>
                      </div>
                      <em>Buying pressure</em>
                    </div>
                    <div className="oi-history__buying-summary-grid">
                      {(['CE', 'PE'] as const).map((optionType) => {
                        const side = optionType === 'CE' ? chartData.optionMomentum.ce : chartData.optionMomentum.pe;
                        return (
                          <div key={optionType} className="oi-history__buying-summary-side">
                            <div className="oi-history__buying-summary-side-head">
                              <strong>{optionType}</strong>
                              <span>{side ? (side.momentumPct >= 0 ? 'Momentum up' : 'Momentum down') : 'No history'}</span>
                            </div>
                            <div className={`oi-history__buying-summary-value ${side && side.momentumPct >= 0 ? 'is-positive' : 'is-negative'}`}>
                              <strong>{side ? formatPct(side.momentumPct) : '-'}</strong>
                              <small>premium change</small>
                            </div>
                            <div className="oi-history__buying-summary-metrics">
                              <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
                              <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
                              <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="oi-history__setup-primary-action">
                    <span>Strategy</span>
                    <strong>{chartData.tradeSetup.strategy}</strong>
                  </div>
                  <div className="oi-history__setup-mini-plan">
                    <div>
                      <span>Trigger</span>
                      <strong>{chartData.tradeSetup.trigger}</strong>
                    </div>
                    <div>
                      <span>Stop</span>
                      <strong>{chartData.tradeSetup.invalidation}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{chartData.tradeSetup.target}</strong>
                    </div>
                  </div>
                  {chartData.tradeSetup.status !== 'Avoid' &&
                    (chartData.tradeSetup.direction === 'Bullish' || chartData.tradeSetup.direction === 'Bearish') && (
                    <button
                      type="button"
                      className="oi-history__setup-trade-btn oi-history__setup-trade-btn--buy"
                      onClick={() => tradeFromSetup('buy')}
                    >
                      Buy {chartData.tradeSetup.direction === 'Bullish' ? 'CE' : 'PE'}
                    </button>
                  )}
                </div>

                <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${chartData.sellingSetup.status.toLowerCase()}`}>
                  <div className="oi-history__setup-mode-card-head">
                    <span>Option Selling Trade</span>
                    <strong>{chartData.sellingSetup.type} {chartData.sellingSetup.status === 'Avoid' ? 'No Trade' : chartData.sellingSetup.status}</strong>
                  </div>
                  <div className="oi-history__readiness-meter">
                    <span>Selling setup</span>
                    <strong>{setupReadinessLabel(chartData.sellingSetup.status, readinessScore(chartData.sellingSetup.checklist))}</strong>
                    <div><span style={{ width: setupReadinessWidth(chartData.sellingSetup.status, readinessScore(chartData.sellingSetup.checklist)) }} /></div>
                  </div>
                  <p>{chartData.sellingSetup.action}</p>
                  <div className="oi-history__buying-summary oi-history__decay-monitor">
                    <div className="oi-history__buying-summary-head">
                      <div>
                        <span>Nearest-expiry decay monitor</span>
                        <strong>{chartData.premiumDecay.nearestExpiry ? expiryLabel(chartData.premiumDecay.nearestExpiry, isMonthlyExpiry(chartData.premiumDecay.nearestExpiry)) : 'Unavailable'}</strong>
                      </div>
                      <em>Time decay</em>
                    </div>
                    <div className="oi-history__buying-summary-grid">
                      {(['CE', 'PE'] as const).map((optionType) => {
                        const side = optionType === 'CE' ? chartData.premiumDecay.ce : chartData.premiumDecay.pe;
                        return (
                          <div key={optionType} className="oi-history__buying-summary-side">
                            <div className="oi-history__buying-summary-side-head">
                              <strong>{optionType}</strong>
                              <span>{side ? (side.decayPct <= 0 ? 'Decay active' : 'Premium rising') : 'No history'}</span>
                            </div>
                            <div className={`oi-history__buying-summary-value ${side && side.decayPct <= 0 ? 'is-positive' : 'is-negative'}`}>
                              <strong>{side ? formatPct(side.decayPct) : '-'}</strong>
                              <small>premium change</small>
                            </div>
                            <div className="oi-history__buying-summary-metrics">
                              <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
                              <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
                              <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="oi-history__setup-primary-action">
                    <span>Structure</span>
                    <strong>{chartData.sellingSetup.type === 'No Sell' ? 'Wait for support/resistance setup' : 'Prefer defined-risk credit spread'}</strong>
                  </div>
                  <div className="oi-history__setup-mini-plan">
                    <div>
                      <span>Trigger</span>
                      <strong>{chartData.sellingSetup.trigger}</strong>
                    </div>
                    <div>
                      <span>Stop</span>
                      <strong>{chartData.sellingSetup.invalidation}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{chartData.sellingSetup.target}</strong>
                    </div>
                  </div>
                  {chartData.sellingSetup.status !== 'Avoid' &&
                    (chartData.sellingSetup.type === 'Call Sell' || chartData.sellingSetup.type === 'Put Sell') && (
                    <button
                      type="button"
                      className="oi-history__setup-trade-btn oi-history__setup-trade-btn--sell"
                      onClick={() => tradeFromSetup('sell')}
                    >
                      Sell {chartData.sellingSetup.type === 'Call Sell' ? 'CE' : 'PE'}
                    </button>
                  )}
                </div>
              </div>

              {signalPerformance && (
                <div className="oi-history__signal-performance oi-history__signal-performance--dashboard">
                  <div className="oi-history__signal-performance-head">
                    <span>Recorded setup performance</span>
                    <div>
                      <strong>{signalPerformance.total} signals · {signalPerformance.open} open · {signalPerformance.evaluated} evaluated</strong>
                      <button type="button" className="oi-history__signal-export" onClick={exportSignalResults}>Export Excel</button>
                    </div>
                  </div>
                  <div className={`oi-history__signal-confidence ${signalPerformance.evaluated >= 20 ? 'is-ready' : ''}`}>
                    {signalPerformance.evaluated >= 20
                      ? 'Performance sample is large enough for an initial review.'
                      : signalPerformance.open > 0
                        ? `${signalPerformance.open} signal${signalPerformance.open === 1 ? '' : 's'} remain open; current return is provisional until expiry.`
                        : `Preliminary sample: ${Math.max(0, 20 - signalPerformance.evaluated)} more evaluated signals needed before trusting the percentages.`}
                  </div>
                  <div className="oi-history__signal-performance-grid">
                    <span>Open <strong>{signalPerformance.open}</strong></span>
                    <span>Current open avg <strong>{signalPerformance.averageOpenReturn === null ? '-' : `${signalPerformance.averageOpenReturn >= 0 ? '+' : ''}${signalPerformance.averageOpenReturn.toFixed(1)}%`}</strong></span>
                    <span>Win rate <strong>{signalPerformance.winRate === null ? '-' : `${signalPerformance.winRate.toFixed(0)}%`}</strong></span>
                    <span>Avg return <strong>{signalPerformance.averageReturn === null ? '-' : `${signalPerformance.averageReturn >= 0 ? '+' : ''}${signalPerformance.averageReturn.toFixed(1)}%`}</strong></span>
                    <span>Avg best move <strong>{signalPerformance.averageMaxFavorable === null ? '-' : `+${signalPerformance.averageMaxFavorable.toFixed(1)}%`}</strong></span>
                    <span>Avg worst move <strong>{signalPerformance.averageMaxAdverse === null ? '-' : `${signalPerformance.averageMaxAdverse.toFixed(1)}%`}</strong></span>
                    <span>Sell <strong>{signalPerformance.sellWinRate === null ? '-' : `${signalPerformance.sellWinRate.toFixed(0)}% (${signalPerformance.sellEvaluated})`}</strong></span>
                    <span>Buy <strong>{signalPerformance.buyWinRate === null ? '-' : `${signalPerformance.buyWinRate.toFixed(0)}% (${signalPerformance.buyEvaluated})`}</strong></span>
                  </div>
                  <div className="oi-history__signal-breakdown">
                    {signalPerformance.optionBreakdown.map((item) => (
                      <span key={item.label}>
                        {item.label}
                        <strong>{item.winRate === null ? '-' : `${item.winRate.toFixed(0)}%`}</strong>
                        <small>{item.evaluated} evaluated{item.averageReturn === null ? '' : ` · ${item.averageReturn >= 0 ? '+' : ''}${item.averageReturn.toFixed(1)}% avg`}</small>
                      </span>
                    ))}
                  </div>
                  <div className="oi-history__signal-quality">
                    <span>Avg win <strong>{signalPerformance.averageWin === null ? '-' : `+${signalPerformance.averageWin.toFixed(1)}%`}</strong></span>
                    <span>Avg loss <strong>{signalPerformance.averageLoss === null ? '-' : `${signalPerformance.averageLoss.toFixed(1)}%`}</strong></span>
                    <span>Profit factor <strong>{signalPerformance.profitFactor === null ? '-' : signalPerformance.profitFactor === Infinity ? '∞' : signalPerformance.profitFactor.toFixed(2)}</strong></span>
                  </div>
                </div>
              )}

              <div className="oi-history__market-context" aria-label="Market context">
                <span className="oi-history__market-context-title">Market context</span>
                <div className="oi-history__market-context-items">
                  <span><small>Price</small><strong>{chartData.priceTrend.direction}</strong></span>
                  <span><small>Flow</small><strong>{chartData.biasSummary.bias} · {chartData.biasSummary.strength}</strong></span>
                  <span><small>Support</small><strong>{chartData.tradeLevels.supportStrike ?? '-'}</strong></span>
                  <span><small>Spot</small><strong>{chartData.tradeLevels.spot !== null ? chartData.tradeLevels.spot.toFixed(2) : '-'}</strong></span>
                  <span><small>Resistance</small><strong>{chartData.tradeLevels.resistanceStrike ?? '-'}</strong></span>
                  <span><small>Max OI</small><strong>{chartData.tradeLevels.maxOiStrike ?? '-'}</strong></span>
                </div>
              </div>

              <details className="oi-history__setup-detail-drawer">
                <summary>
                  <span>Why this setup?</span>
                  <em>Evidence, risk checks, and market context</em>
                </summary>
                <div className="oi-history__setup-evidence-grid">
                  <div className="oi-history__setup-detail-section oi-history__setup-detail-section--buying">
                    <div className="oi-history__setup-section-heading">
                      <span>Option buying</span>
                      <strong>{setupReadinessLabel(chartData.tradeSetup.status, readinessScore(chartData.tradeSetup.checklist))}</strong>
                    </div>
                  <div className="oi-history__setup-signal-strip">
                    {sortChecklistByStatus(chartData.tradeSetup.checklist).map((item) => (
                      <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status}`}>
                        <span>{item.label}</span>
                        <strong>{checklistStatusText(item.status)}</strong>
                        <em>{item.answer}</em>
                      </div>
                    ))}
                  </div>
                  </div>
                  <div className="oi-history__setup-detail-section oi-history__setup-detail-section--selling">
                    <div className="oi-history__setup-section-heading">
                      <span>Option selling</span>
                      <strong>{setupReadinessLabel(chartData.sellingSetup.status, readinessScore(chartData.sellingSetup.checklist))}</strong>
                    </div>
                  <div className="oi-history__setup-signal-strip">
                    {sortChecklistByStatus(chartData.sellingSetup.checklist).map((item) => (
                      <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status}`}>
                        <span>{item.label}</span>
                        <strong>{checklistStatusText(item.status)}</strong>
                        <em>{item.answer}</em>
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
                <div className="oi-history__setup-context">
                  <div className={`oi-history__setup-context-item oi-history__setup-context-item--${chartData.tradeBias.bias.toLowerCase()}`}>
                    <span>Trade bias</span>
                    <strong>{chartData.tradeBias.title}</strong>
                    <em>{chartData.tradeBias.action} {chartData.tradeBias.reason}</em>
                  </div>
                  <div className={`oi-history__setup-context-item oi-history__setup-context-item--${chartData.priceTrend.direction.toLowerCase()}`}>
                    <span>Price trend</span>
                    <strong>{chartData.priceTrend.direction} - {chartData.priceTrend.strength}</strong>
                    <em>
                      {chartData.priceTrend.reason} Start {chartData.priceTrend.startPrice !== null ? chartData.priceTrend.startPrice.toFixed(2) : '-'} | End {chartData.priceTrend.endPrice !== null ? chartData.priceTrend.endPrice.toFixed(2) : '-'} | Change {formatPct(chartData.priceTrend.changePct)} | Recent {formatPct(chartData.priceTrend.recentChangePct)} | Sessions {chartData.priceTrend.sessions}
                    </em>
                  </div>
                  <div className={`oi-history__setup-context-item oi-history__setup-context-item--${chartData.biasSummary.bias.toLowerCase()}`}>
                    <span>Option flow</span>
                    <strong>{chartData.biasSummary.bias} - {chartData.biasSummary.strength}</strong>
                    <em>
                      {chartData.biasSummary.reason} Confidence {chartData.biasSummary.confidence}% | Days {chartData.biasSummary.bullishDays}/{chartData.biasSummary.bearishDays}/{chartData.biasSummary.neutralDays} | CE OI {formatPct(chartData.biasSummary.ceOiChangePct)} | PE OI {formatPct(chartData.biasSummary.peOiChangePct)} | PCR {formatPcr(chartData.biasSummary.pcrStart)} -&gt; {formatPcr(chartData.biasSummary.pcrEnd)} | Score {chartData.biasSummary.score}
                    </em>
                  </div>
                </div>
                <div className="oi-history__setup-details">
                  <div>
                    <span>Recent 3-session lean</span>
                    <strong className={`oi-history__bias-text--${chartData.biasSummary.recentBias.toLowerCase()}`}>
                      {chartData.biasSummary.recentBias} ({chartData.biasSummary.recentScore > 0 ? '+' : ''}{chartData.biasSummary.recentScore})
                    </strong>
                  </div>
                  <div>
                    <span>Main driver</span>
                    <strong>{chartData.biasSummary.driver}</strong>
                  </div>
                  <div>
                    <span>Visible expiries</span>
                    <strong>{visibleTableExpiries.map((exp) => expiryLabel(exp, isMonthlyExpiry(exp))).join(', ')}</strong>
                  </div>
                  {chartData.biasSummary.warning && (
                    <div className="oi-history__bias-warning">
                      <span>Watch</span>
                      <strong>{chartData.biasSummary.warning}</strong>
                    </div>
                  )}
                </div>
              </details>
            </div>
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
