import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleKiteAuthFailure } from '@/services/authSession';
import { apiClient } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import { useKiteSession } from '@/hooks/useKiteSession';
import '@/styles/oihistory.css';
import { currentMonthIST } from './helpers';
import { computeMonthlyExpiries } from './expiries';
import { FuturesContext } from './FuturesContext';
import { OiSnapshotTable } from './OiSnapshotTable';
import OiHistoryShimmer from './OiHistoryShimmer';
import StockSetupsPanel from '@/components/StockSetups/StockSetupsPanel';
import { useUnderlyings } from '@/hooks/useUnderlyings';
import { computeFlowReadings, type FlowReading } from '@/services/oiFlow';
import { computeFairValues } from '@/services/fairValue';
import type { SideId } from '../../../shared/tradeEnums.js';
import { OiHistoryTab, ToastColor, type OiHistoryTabId } from '@/utils/uiEnums';
import ToastStack from '@/components/Toast/ToastStack';
import OrderModal from '@/components/OrderModal/OrderModal';
import { useToasts } from '@/hooks/useToasts';
import {
  STRIKE_RANGE, buildOiTable, expiryColors as colorsForExpiries, fairInputs, flowInputs, latestVisibleDate,
  maxConsolidatedOi as largestConsolidatedOi, nearestStrike, oiSeriesByToken, rowsByDate as groupRowsByDate, sortedUnique, strikesInRange,
} from './oiTable';
import { buildStrikeChart } from './strikeChart';
import { setupOrder, signalToLog } from './setupSignals';
import { useExpiryMonths, useScripChoice, useStrikeChoice } from './useOiHistorySelection';
import { useOiHistoryData } from './useOiHistoryData';
import { useOiHistoryFetch } from './useOiHistoryFetch';
import { useSignalLogging, useTradeSignals } from './useTradeSignals';
import { useUnderlyingStock } from './useUnderlyingStock';
import { useOiHistoryOrders } from './useOiHistoryOrders';
import { useExpiryVisibility } from './useExpiryVisibility';
import { useFairValueView } from './useFairValueView';
import OiHistoryControls from './OiHistoryControls';
import DateBar from './DateBar';
import StrikeHistoryCard from './StrikeHistoryCard';
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
  const [showVolume, setShowVolume] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAdmin = useKiteSession().session?.isAdmin === true;
  const lastLoadedRef = useRef('');
  const { underlyingStock, showZones, openZones, closeZones } = useUnderlyingStock(scrip);

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
  const { orderChoices, orderTicket, openOrder, closeOrder, handleTrade } = useOiHistoryOrders(showToast);

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
  const { hiddenExpiries, visibleTableExpiries, toggleExpiryVisibility, showExpiry } = useExpiryVisibility(tableExpiries);

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
  const rowsByDate = useMemo(() => groupRowsByDate(data), [data]);
  const { showFairValue, setShowFairValue, chartFairExpiry, chartExpiries, fairByDate, fairSummary, selectFairExpiry } = useFairValueView({
    visibleTableExpiries, filterDate, filteredRows, availableDates, rowsByDate, fairToday, showExpiry,
  });

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

  // A fetch rewrites the history on screen, so its old rows give way to the outline until the fresh data loads.
  const showShimmer = fetching || (loading && data.length === 0);

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
          onClose={closeOrder}
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

      {showShimmer ? <OiHistoryShimmer /> : (
        <>
          <DateBar dates={visibleDates} selected={filterDate} expiryDates={expiryMarkerDates} onSelect={setFilterDate} />
          <FuturesContext futuresData={futuresData} filterDate={filterDate} scrip={scrip} />
        </>
      )}

      {!showShimmer && tableData.length > 0 && (
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

      {!showShimmer && chartData && selectedStrike && (
        <StrikeHistoryCard
          strike={selectedStrike}
          chart={chartData}
          tab={analysisTab}
          onTab={setAnalysisTab}
          zonesSymbol={underlyingStock?.tradingsymbol ?? null}
          onShowZones={openZones}
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
