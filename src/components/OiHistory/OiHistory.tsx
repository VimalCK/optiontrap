import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleKiteAuthFailure } from '@/services/authSession';
import { apiClient } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import { useKiteSession } from '@/hooks/useKiteSession';
import { tradeErrorMessage } from '@/services/positions';
import { placeMarketTrade, placedOrderMessage, placedOrderRefused } from '@/services/orders';
import { getLotSize } from '@/services/optionChain';
import { loadInstruments, getLotSizeByToken } from '@/services/instruments';
import '@/styles/oihistory.css';
import type { OiCellData } from './types';
import { currentMonthIST } from './helpers';
import { computeMonthlyExpiries } from './analysis';
import { FuturesContext } from './FuturesContext';
import { OiSnapshotTable } from './OiSnapshotTable';
import StockSetupsPanel from '@/components/StockSetups/StockSetupsPanel';
import { findNseStock } from '@/services/stockSetups';
import { useUnderlyings } from '@/hooks/useUnderlyings';
import { computeFlowReadings, type FlowReading } from '@/services/oiFlow';
import { computeFairValues, realizedVol, volVerdict, type FairValueResult } from '@/services/fairValue';
import { Horizon, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { OiHistoryTab, ToastColor, type OiHistoryTabId } from '@/utils/uiEnums';
import ToastStack from '@/components/Toast/ToastStack';
import OrderModal from '@/components/OrderModal/OrderModal';
import { useOrderChoices } from '@/components/OrderModal/useOrderChoices';
import type { OrderOption } from '@/components/OrderModal/orderTicket';
import { useToasts } from '@/hooks/useToasts';
import LoadingState from '@/components/LoadingState/LoadingState';
import {
  STRIKE_RANGE, buildOiTable, cellOption, expiryColors as colorsForExpiries, fairInputs, flowInputs, latestVisibleDate,
  maxConsolidatedOi as largestConsolidatedOi, nearestStrike, oiSeriesByToken, rowsByDate as groupRowsByDate, sortedUnique, strikesInRange,
} from './oiTable';
import { buildStrikeChart } from './strikeChart';
import { setupOrder, signalToLog } from './setupSignals';
import { useExpiryMonths, useScripChoice, useStrikeChoice } from './useOiHistorySelection';
import { useOiHistoryData, useOiHistoryFetch } from './useOiHistoryData';
import { useSignalLogging, useTradeSignals } from './useTradeSignals';
import OiHistoryControls from './OiHistoryControls';
import DateBar from './DateBar';
import StrikeHistoryCard, { type FairSummary } from './StrikeHistoryCard';
import DeleteScripDialog from './DeleteScripDialog';

const OiHistory: React.FC = () => {
  const navigate = useNavigate();
  // Cancels this tab's in-flight requests when the user navigates away.
  const pageSignal = useAbortSignal();
  const underlyings = useUnderlyings();
  const { scrip, selectScrip, scripOptions, recentScripOptions } = useScripChoice(underlyings);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const months = useExpiryMonths(scrip, pageSignal, setFetchError);
  const { strikeRange, setStrikeRange, specificStrike, setSpecificStrike, specificStrikeValue } = useStrikeChoice();
  const { data, futuresData, dataScrip, loading, load, clear } = useOiHistoryData(scrip, months.includedExpiryMonths, pageSignal);
  const { fetching, progress, fetchMonths } = useOiHistoryFetch(scrip, strikeRange, specificStrikeValue, pageSignal);

  const [filterDate, setFilterDate] = useState('');
  const [analysisTab, setAnalysisTab] = useState<OiHistoryTabId>(OiHistoryTab.History);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(() => new Set());
  const [showVolume, setShowVolume] = useState(false);
  const [showFairValue, setShowFairValue] = useState(false);
  const [fairExpiry, setFairExpiry] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAdmin = useKiteSession().session?.isAdmin === true;
  const lastLoadedRef = useRef('');

  // Entry & exit zones of the underlying stock (null for indices).
  const [underlyingStock, setUnderlyingStock] = useState<{ instrumentToken: number; tradingsymbol: string } | null>(null);
  const [showZones, setShowZones] = useState(false);
  const closeZones = useCallback(() => setShowZones(false), []);

  useEffect(() => {
    let stale = false;
    setUnderlyingStock(null);
    setShowZones(false);
    if (!scrip) return;
    findNseStock(scrip)
      .then((stock) => { if (!stale) setUnderlyingStock(stock); })
      .catch(() => { /* no zones button */ });
    return () => { stale = true; };
  }, [scrip]);

  // Warm the instruments cache so lot sizes are available for setup trades.
  useEffect(() => {
    loadInstruments().catch(() => { /* lot size falls back to 1 if unavailable */ });
  }, []);

  const loadData = useCallback(async () => {
    const rows = await load();
    const latest = rows ? latestVisibleDate(rows, currentMonthIST()) : null;
    if (latest) setFilterDate(latest);
  }, [load]);

  // When scrip or expiry month changes, load existing data from the DB only.
  // Fetching fresh data from Kite is an explicit action via the Fetch button.
  useEffect(() => {
    const key = `${scrip}_${months.selectedExpiryMonth}`;
    if (lastLoadedRef.current === key) return;
    lastLoadedRef.current = key;
    clear();
    setSelectedStrike(null);
    setFilterDate('');
    setFetchResult(null);
    setFetchError(null);
    if (scrip) loadData();
  }, [scrip, months.selectedExpiryMonth, loadData, clear]);

  /** Fetch current/future included expiry months from Kite. Historical months are loaded from DB only. */
  const handleFetch = useCallback(async () => {
    if (strikeRange === STRIKE_RANGE.Specific && specificStrikeValue === null) {
      setFetchError('Enter a valid strike to fetch specific OI history.');
      return;
    }
    if (months.fetchableExpiryMonths.length === 0) {
      setFetchResult('Selected month is historical only. Stored database data is already loaded.');
      return;
    }
    setFetchResult(null);
    setFetchError(null);
    const outcome = await fetchMonths(months.fetchableExpiryMonths);
    if (!outcome.ok && 'loginEnded' in outcome) {
      if (outcome.loginEnded) {
        handleKiteAuthFailure();
        navigate('/login', { replace: true });
      } else {
        setFetchError(outcome.message);
      }
    }
    if (!pageSignal.aborted) loadData();
  }, [months.fetchableExpiryMonths, fetchMonths, loadData, navigate, strikeRange, specificStrikeValue, pageSignal]);

  /** Delete all OI history for the selected scrip (admins only: the history is shared by every user). */
  const handleDeleteAll = useCallback(async () => {
    setConfirmDelete(false);
    try {
      // apiClient throws on any error reply, so reaching here means it worked.
      await apiClient.delete<{ deleted: number }>(`/api/oi-history?${new URLSearchParams({ scrip })}`);
      clear();
      lastLoadedRef.current = '';
      setSelectedStrike(null);
      setFilterDate('');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    }
  }, [scrip, clear]);

  const { toasts, showToast } = useToasts();
  const orderChoices = useOrderChoices();
  const [orderTicket, setOrderTicket] = useState<{ option: OrderOption; price: number } | null>(null);

  const openOrder = useCallback((cell: OiCellData, optionType: OptionTypeId, strike: number, expiry: string) => {
    const { token, tradingsymbol, close } = cellOption(cell, optionType);
    if (!token || !tradingsymbol || !close) return;
    const lotSize = getLotSizeByToken(token) ?? getLotSize(token);
    setOrderTicket({ option: { tradingsymbol, instrumentToken: token, lotSize, strike, optionType, expiry }, price: close });
  }, []);

  const handleTrade = useCallback(async (cell: OiCellData, optionType: OptionTypeId, side: SideId, strike: number, expiry: string) => {
    const { token, tradingsymbol, close } = cellOption(cell, optionType);
    if (!token || !tradingsymbol || !close) return;
    try {
      // A market order: the server fills it at the live bid / ask, not the grid's historical close.
      const placed = await placeMarketTrade({
        tradingsymbol,
        instrumentToken: token,
        strike,
        optionType,
        side,
        quantity: getLotSizeByToken(token) ?? getLotSize(token),
        expiry,
        horizon: Horizon.Intraday,
      });
      showToast(placedOrderMessage(placed, `${side} ${strike}${optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
    } catch (err) {
      showToast(tradeErrorMessage(err), ToastColor.Red);
    }
  }, [showToast]);

  const availableDates = useMemo(() => sortedUnique(data.map((r) => r.date)), [data]);
  const visibleDates = useMemo(() => availableDates.filter((date) => date.slice(0, 7) >= currentMonthIST()), [availableDates]);
  const expiries = useMemo(() => sortedUnique(data.map((r) => r.expiry)), [data]);
  const monthlyExpirySet = useMemo(() => computeMonthlyExpiries(expiries), [expiries]);
  const isMonthlyExpiry = useCallback((expiry: string) => monthlyExpirySet.has(expiry), [monthlyExpirySet]);
  /** Mark only actual contract expiry dates; weekdays can vary around holidays. */
  const expiryMarkerDates = useMemo(() => new Set(expiries), [expiries]);

  const filteredRows = useMemo(() => (filterDate ? data.filter((r) => r.date === filterDate) : []), [data, filterDate]);
  /** Expiries available on the selected date. Expired weekly contracts are not shown after expiry. */
  const tableExpiries = useMemo(() => sortedUnique(filteredRows.map((r) => r.expiry)), [filteredRows]);
  const visibleTableExpiries = useMemo(() => tableExpiries.filter((exp) => !hiddenExpiries.has(exp)), [tableExpiries, hiddenExpiries]);

  const prevDate = useMemo(() => {
    const index = availableDates.indexOf(filterDate);
    return filterDate && index > 0 ? availableDates[index - 1] : null;
  }, [availableDates, filterDate]);
  const prevDateRows = useMemo(() => (prevDate ? data.filter((r) => r.date === prevDate) : []), [data, prevDate]);

  const oiSeries = useMemo(() => oiSeriesByToken(data), [data]);
  const flowByToken = useMemo(
    () => (prevDate ? computeFlowReadings(flowInputs(filteredRows, prevDateRows, filterDate, prevDate, oiSeries)) : new Map<number, FlowReading>()),
    [filteredRows, prevDateRows, filterDate, prevDate, oiSeries],
  );

  /** Fair value for every option on the selected date (logged with signals, and the chart summary). */
  const fairToday = useMemo(() => computeFairValues(fairInputs(filteredRows, filterDate)), [filteredRows, filterDate]);

  /**
   * Expiry the fair-value chart shows: the picked one if still visible, else the nearest
   * one still running after the selected date. An expiry ending that day has no time
   * value left, so its IV is undefined and its straddle near zero.
   */
  const chartFairExpiry = useMemo(() => {
    if (!showFairValue) return null;
    if (fairExpiry && visibleTableExpiries.includes(fairExpiry)) return fairExpiry;
    return visibleTableExpiries.find((exp) => exp.slice(0, 10) > filterDate) ?? visibleTableExpiries[0] ?? null;
  }, [showFairValue, fairExpiry, visibleTableExpiries, filterDate]);

  const chartExpiries = useMemo(() => (chartFairExpiry ? [chartFairExpiry] : visibleTableExpiries), [chartFairExpiry, visibleTableExpiries]);
  const rowsByDate = useMemo(() => groupRowsByDate(data), [data]);

  /** Fair values of the chart's expiry on every date; only computed while the fair-value view is on. */
  const fairByDate = useMemo(() => {
    const map = new Map<string, FairValueResult>();
    if (!chartFairExpiry) return map;
    for (const [date, rows] of rowsByDate) map.set(date, computeFairValues(fairInputs(rows, date, chartFairExpiry)));
    return map;
  }, [rowsByDate, chartFairExpiry]);

  const fairSummary = useMemo((): FairSummary | null => {
    if (!chartFairExpiry || !filterDate) return null;
    const stats = fairToday.byExpiry.get(chartFairExpiry) ?? null;
    const spotCloses = availableDates
      .filter((date) => date <= filterDate)
      .map((date) => rowsByDate.get(date)?.find((r) => r.spotClose > 0)?.spotClose ?? 0);
    const realized = realizedVol(spotCloses);
    const spot = filteredRows.find((r) => r.spotClose > 0)?.spotClose ?? null;
    return { stats, realized, verdict: volVerdict(stats?.atmIv ?? null, realized), spot };
  }, [chartFairExpiry, filterDate, fairToday, availableDates, rowsByDate, filteredRows]);

  const atmStrike = useMemo(() => nearestStrike(filteredRows), [filteredRows]);
  const selectedSpotClose = filteredRows[0]?.spotClose ?? null;

  useEffect(() => {
    if (strikeRange === STRIKE_RANGE.Specific && specificStrikeValue !== null) {
      setSelectedStrike(specificStrikeValue);
      return;
    }
    if (atmStrike) setSelectedStrike(atmStrike);
  }, [atmStrike, strikeRange, specificStrikeValue]);

  const tableData = useMemo(
    () => strikesInRange(buildOiTable(filteredRows, prevDateRows, visibleTableExpiries, isMonthlyExpiry), strikeRange, specificStrikeValue, atmStrike),
    [filteredRows, prevDateRows, visibleTableExpiries, isMonthlyExpiry, strikeRange, specificStrikeValue, atmStrike],
  );
  const maxConsolidatedOi = useMemo(() => largestConsolidatedOi(tableData), [tableData]);

  // When the selected strike is no longer visible in the table (e.g. after narrowing the strike range),
  // fall back to the ATM strike if it's visible, otherwise clear the selection.
  useEffect(() => {
    if (selectedStrike === null || strikeRange === STRIKE_RANGE.Specific) return;
    if (tableData.some((r) => r.strike === selectedStrike)) return;
    setSelectedStrike(atmStrike && tableData.some((r) => r.strike === atmStrike) ? atmStrike : null);
  }, [tableData, selectedStrike, atmStrike, strikeRange]);

  const chartData = useMemo(() => (selectedStrike ? buildStrikeChart({
    rows: data,
    strike: selectedStrike,
    dates: availableDates,
    expiries: visibleTableExpiries,
    drawnExpiries: chartExpiries,
    fairByDate,
    tableRows: tableData,
    spotClose: selectedSpotClose,
  }) : null), [data, selectedStrike, availableDates, visibleTableExpiries, selectedSpotClose, tableData, fairByDate, chartExpiries]);

  // Each actionable setup is recorded once per page load, for outcome tracking and backtesting.
  const setupSignal = useMemo(() => (chartData && selectedStrike && dataScrip === scrip ? signalToLog({
    scrip, strike: selectedStrike, chart: chartData, rows: data, tableDate: filterDate, tableRows: tableData, flowByToken, fairToday,
  }) : null), [chartData, data, scrip, dataScrip, selectedStrike, filterDate, tableData, flowByToken, fairToday]);
  useSignalLogging(setupSignal);

  const onDeleteSignalFailed = useCallback(() => showToast('Failed to delete signal', ToastColor.Red), [showToast]);
  const { signalRows, signalPerformance, deleteSignal } = useTradeSignals(scrip, chartData, pageSignal, onDeleteSignalFailed);

  const tradeFromSetup = useCallback((side: SideId) => {
    if (!chartData) return;
    const order = setupOrder(side, chartData, atmStrike, tableData, visibleTableExpiries);
    if (!order.ok) {
      showToast(order.message, ToastColor.Red);
      return;
    }
    void handleTrade(order.cell, order.optionType, side, order.strike, order.expiry);
  }, [chartData, atmStrike, tableData, visibleTableExpiries, handleTrade, showToast]);

  const expiryColors = useMemo(() => colorsForExpiries(expiries), [expiries]);

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

  /** Hide or show an expiry in the table and chart; the last one shown stays. */
  const toggleExpiryVisibility = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const isHidden = prev.has(expiry);
      if (!isHidden && tableExpiries.filter((exp) => !prev.has(exp)).length <= 1) return prev;
      const next = new Set(prev);
      if (isHidden) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  return (
    <div className="oi-history">
      <ToastStack toasts={toasts} />
      {orderTicket && (
        <OrderModal
          key={orderTicket.option.tradingsymbol}
          option={orderTicket.option}
          initialPrice={orderTicket.price}
          priceLabel="Day close"
          choices={orderChoices}
          onClose={() => setOrderTicket(null)}
          onToast={showToast}
        />
      )}

      <OiHistoryControls
        scrip={scrip}
        scripOptions={scripOptions}
        recentScripOptions={recentScripOptions}
        onScrip={selectScrip}
        expiryMonth={months.selectedExpiryMonth}
        expiryMonthOptions={months.selectableExpiryMonthOptions}
        onExpiryMonth={months.setSelectedExpiryMonth}
        strikeRange={strikeRange}
        onStrikeRange={setStrikeRange}
        specificStrike={specificStrike}
        onSpecificStrike={setSpecificStrike}
        fetchableMonths={months.fetchableExpiryMonths}
        fetching={fetching}
        onFetch={handleFetch}
        onDeleteAll={isAdmin ? () => setConfirmDelete(true) : undefined}
        progress={progress}
        status={fetchResult}
        error={fetchError}
      />

      <DateBar dates={visibleDates} selected={filterDate} expiryDates={expiryMarkerDates} onSelect={setFilterDate} />

      <FuturesContext futuresData={futuresData} filterDate={filterDate} scrip={scrip} />

      {(loading || fetching) && data.length === 0 && (
        <div className="card">
          <LoadingState label="Loading data…" />
        </div>
      )}

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
          onOpenOrder={openOrder}
        />
      )}

      {chartData && selectedStrike && (
        <StrikeHistoryCard
          strike={selectedStrike}
          chart={chartData}
          tab={analysisTab}
          onTab={setAnalysisTab}
          zonesSymbol={underlyingStock?.tradingsymbol ?? null}
          onShowZones={() => setShowZones(true)}
          tableExpiries={tableExpiries}
          visibleExpiries={visibleTableExpiries}
          hiddenExpiries={hiddenExpiries}
          chartExpiries={chartExpiries}
          fairExpiry={chartFairExpiry}
          isMonthlyExpiry={isMonthlyExpiry}
          expiryColors={expiryColors}
          onToggleExpiry={toggleExpiryVisibility}
          onPickFairExpiry={selectFairExpiry}
          showVolume={showVolume}
          onShowVolume={setShowVolume}
          showFairValue={showFairValue}
          onShowFairValue={setShowFairValue}
          fairSummary={fairSummary}
          filterDate={filterDate}
          signalPerformance={signalPerformance}
          signalRows={signalRows}
          onTrade={tradeFromSetup}
          onDeleteSignal={deleteSignal}
        />
      )}

      {data.length === 0 && !loading && !fetching && (
        <div className="oi-history__empty card">
          Select an expiry month and click <strong>Fetch</strong> to download OI history up to today.
          Already-fetched trading days for that expiry month are skipped automatically.
        </div>
      )}

      {confirmDelete && (
        <DeleteScripDialog
          label={scripOptions.find((o) => o.value === scrip)?.label || scrip}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDeleteAll}
        />
      )}

      {showZones && underlyingStock && (
        <StockSetupsPanel
          instrumentToken={underlyingStock.instrumentToken}
          tradingsymbol={underlyingStock.tradingsymbol}
          livePrice={undefined}
          onClose={closeZones}
        />
      )}
    </div>
  );
};

export default OiHistory;
