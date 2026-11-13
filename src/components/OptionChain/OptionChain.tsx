import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SellStrategy from '@/components/SellStrategy/SellStrategy';
import { averageVolume } from '../../../shared/optionAnalysis/chain.js';
import IconButton from '@/components/IconButton/IconButton';
import { InfoIcon } from '@/components/icons/Icons';
import { calculateExpectedMove } from '@/services/edgeScore';
import { calculateVelocity, type OiVelocity } from '@/services/oiSnapshots';
import { computeStrikeSignals } from '@/services/combinedSignal';
import { tradeErrorMessage } from '@/services/positions';
import { placeMarketTrade, placedOrderMessage, placedOrderRefused } from '@/services/orders';
import OrderModal from '@/components/OrderModal/OrderModal';
import { useOrderChoices } from '@/components/OrderModal/useOrderChoices';
import { computeLiveFlow } from '@/services/oiFlow';
import { SellStrategyGuide, BuyStrategyGuide, PositionAnalyzerGuide } from './AnalyzerGuides';
import { MessageTone, ToastColor } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import ToastStack from '@/components/Toast/ToastStack';
import LoadingState from '@/components/LoadingState/LoadingState';
import { useToasts } from '@/hooks/useToasts';
import { isAbortError } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import { fetchOptions, getExpiries, buildOptionChain, type OptionInstrument, type OptionChainRow } from '@/services/optionChain';
import { fetchUnderlyings, type Underlying } from '@/services/underlyings';
import { istDaysUntil } from '@/utils/marketStatus';
import { Horizon, OptionType, TradingMode, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { StrategyMode, type StrategyModeId } from '../../../shared/appEnums.js';
import ChainControls from './ChainControls';
import ChainTable from './ChainTable';
import OiChart from './OiChart';
import { useLiveChain, useOiSnapshots, usePrevDayOi, useSymbolChoice } from './useChainData';
import '@/styles/optionchain.css';

const OptionChain: React.FC = () => {
  // Cancels this tab's in-flight requests when the user navigates away.
  const signal = useAbortSignal();
  const [underlyings, setUnderlyings] = useState<Underlying[]>([]);
  const symbolOptions = useMemo(() => underlyings.map((u) => ({ value: u.name, label: u.label })), [underlyings]);
  const { selectedSymbol, selectSymbol, recentSymbolOptions } = useSymbolChoice(symbolOptions);
  // The selected symbol's price instrument (an index row or the stock's NSE row).
  const underlying = useMemo(() => underlyings.find((u) => u.name === selectedSymbol) ?? null, [underlyings, selectedSymbol]);
  const [options, setOptions] = useState<OptionInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [showStrategyInfo, setShowStrategyInfo] = useState(false);
  const [strategyMode, setStrategyMode] = useState<StrategyModeId>(StrategyMode.Sell);
  const [orderForm, setOrderForm] = useState<{ strike: number; optionType: OptionTypeId; price: number } | null>(null);
  const orderChoices = useOrderChoices();
  const orderMode = orderChoices.mode;
  const { toasts, showToast } = useToasts();
  const chainCardRef = useRef<HTMLDivElement>(null);
  const chainCardLockedHeight = useRef<number | null>(null);

  useEffect(() => {
    fetchUnderlyings(signal).then(setUnderlyings).catch((err) => {
      if (!isAbortError(err)) console.error('[Option Analyzer] Could not load symbols:', err);
    });
  }, []);

  useEffect(() => {
    if (!selectedSymbol) return;
    setLoading(true);
    setError(null);
    fetchOptions(selectedSymbol, signal)
      .then((data) => {
        setOptions(data);
        const expiries = getExpiries(data);
        if (expiries.length > 0) setSelectedExpiry(expiries[0]);
      })
      .catch((err) => {
        if (!isAbortError(err)) setError(err instanceof Error ? err.message : 'Failed to load option chain');
      })
      .finally(() => setLoading(false));
  }, [selectedSymbol]);

  const expiries = useMemo(() => getExpiries(options), [options]);
  const chain: OptionChainRow[] = useMemo(() => (selectedExpiry ? buildOptionChain(options, selectedExpiry) : []), [options, selectedExpiry]);

  const { atmStrike, visibleChain, livePrices, closePrices, oiData, volumeData, spotPrice, spotPrevClose } = useLiveChain({ chain, expiry: selectedExpiry, underlying, resetKey: options, signal });
  const prevDayOi = usePrevDayOi(visibleChain);
  const snapshots = useOiSnapshots(selectedSymbol, underlying?.instrumentToken ?? null, signal);
  const avgVolume = useMemo(() => averageVolume(visibleChain, volumeData), [visibleChain, volumeData]);

  // IV-based flow per option against the previous close (shown alongside OI + Price, not scored)
  const flowByToken = useMemo(
    () => computeLiveFlow(chain, oiData, prevDayOi, livePrices, closePrices, spotPrice, spotPrevClose || undefined, volumeData),
    [chain, oiData, prevDayOi, livePrices, closePrices, spotPrice, spotPrevClose, volumeData],
  );
  const strikeSignals = useMemo(
    () => computeStrikeSignals(visibleChain, oiData, livePrices, snapshots, volumeData, avgVolume),
    [visibleChain, oiData, livePrices, snapshots, volumeData, avgVolume],
  );
  const daysToExpiry = useMemo(() => (selectedExpiry ? Math.max(0, istDaysUntil(selectedExpiry)) : undefined), [selectedExpiry]);
  const expectedMove = useMemo(() => calculateExpectedMove(visibleChain, atmStrike, livePrices), [visibleChain, atmStrike, livePrices]);

  const [oiVelocity, setOiVelocity] = useState<Map<number, OiVelocity>>(new Map());
  useEffect(() => {
    if (snapshots.length > 0 && oiData.size > 0) setOiVelocity(calculateVelocity(oiData, snapshots));
  }, [oiData, snapshots]);

  // Lock the chain card's height once strikes are loaded, so it doesn't jerk.
  useEffect(() => {
    if (visibleChain.length > 0 && chainCardRef.current && chainCardLockedHeight.current === null) {
      requestAnimationFrame(() => {
        if (!chainCardRef.current) return;
        chainCardLockedHeight.current = chainCardRef.current.offsetHeight;
        chainCardRef.current.style.minHeight = `${chainCardLockedHeight.current}px`;
      });
    }
  }, [visibleChain.length]);

  const quickTrade = useCallback(async (instrument: OptionInstrument, strike: number, optionType: OptionTypeId, side: SideId): Promise<boolean> => {
    try {
      const placed = await placeMarketTrade({
        tradingsymbol: instrument.tradingsymbol,
        instrumentToken: instrument.instrumentToken,
        strike,
        optionType,
        side,
        quantity: instrument.lotSize,
        expiry: selectedExpiry,
        horizon: Horizon.Intraday,
      });
      showToast(placedOrderMessage(placed, `${side} ${strike}${optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
      return true;
    } catch (err) {
      showToast(tradeErrorMessage(err), ToastColor.Red);
      return false;
    }
  }, [selectedExpiry, showToast]);

  const toggleOrder = (strike: number, optionType: OptionTypeId, price: number) => {
    setOrderForm((open) => (open?.strike === strike && open.optionType === optionType ? null : { strike, optionType, price }));
  };

  const chainReady = !loading && !error && visibleChain.length > 0;
  const paperTrade = orderMode === TradingMode.Paper ? quickTrade : undefined;
  const chainPrices = { livePrices, closePrices, oiData, prevDayOi };
  const orderRow = orderForm ? visibleChain.find((r) => r.strike === orderForm.strike) : undefined;
  const orderInstrument = orderForm ? (orderForm.optionType === OptionType.CE ? orderRow?.ce : orderRow?.pe) : undefined;

  return (
    <div>
      <ToastStack toasts={toasts} />
      {(expiries.length > 0 || !selectedSymbol) && (
        <ChainControls
          symbol={selectedSymbol}
          symbolOptions={symbolOptions}
          recentSymbolOptions={recentSymbolOptions}
          onSymbol={selectSymbol}
          expiry={selectedExpiry}
          expiries={expiries}
          onExpiry={setSelectedExpiry}
          daysToExpiry={daysToExpiry}
        />
      )}

      <div className="card option-chain-card" ref={chainCardRef}>
        {loading && <LoadingState label="Loading option chain…" />}
        {error && (
          <div style={{ padding: 16 }}>
            <Message tone={MessageTone.Error}>{error}</Message>
          </div>
        )}
        {chainReady && (
          <ChainTable chain={visibleChain} atmStrike={atmStrike} prices={chainPrices} orderOpen={orderForm} onOpenOrder={toggleOrder} onQuickTrade={paperTrade} />
        )}
        {!selectedSymbol && (
          <p className="card__description" style={{ marginTop: 16 }}>Select a symbol to see its option chain.</p>
        )}
        {selectedSymbol && !loading && !error && options.length === 0 && (
          <p className="card__description" style={{ marginTop: 16 }}>No option data available.</p>
        )}
      </div>

      {orderForm && orderInstrument && (
        <OrderModal
          key={`${orderForm.strike}${orderForm.optionType}`}
          option={{ tradingsymbol: orderInstrument.tradingsymbol, instrumentToken: orderInstrument.instrumentToken, lotSize: orderInstrument.lotSize, strike: orderForm.strike, optionType: orderForm.optionType, expiry: selectedExpiry }}
          initialPrice={orderForm.price}
          priceLabel="LTP"
          choices={orderChoices}
          onClose={() => setOrderForm(null)}
          onToast={showToast}
        />
      )}

      {chainReady && (
        <OiChart
          chain={visibleChain}
          atmStrike={atmStrike}
          prices={{ ...chainPrices, volumeData }}
          averageVolume={avgVolume}
          spotPrice={spotPrice}
          expectedMove={expectedMove}
          velocity={oiVelocity}
          snapshots={snapshots}
          flowByToken={flowByToken}
          strikeSignals={strikeSignals}
          onQuickTrade={paperTrade}
        />
      )}

      {chainReady && (
        <div className="card" style={{ marginTop: 'var(--card-gap)' }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <h3 className="card__title" style={{ marginBottom: 0 }}>Strategy</h3>
              <IconButton icon={<InfoIcon />} label="How this works" onClick={() => setShowStrategyInfo(!showStrategyInfo)} expanded={showStrategyInfo} />
            </div>
          </div>
          {showStrategyInfo && (
            strategyMode === StrategyMode.Sell ? <SellStrategyGuide />
              : strategyMode === StrategyMode.Buy ? <BuyStrategyGuide />
                : <PositionAnalyzerGuide />
          )}
          <SellStrategy
            chain={visibleChain}
            oiData={oiData}
            livePrices={livePrices}
            prevDayOi={prevDayOi}
            closePrices={closePrices}
            snapshots={snapshots}
            spotPrice={spotPrice}
            daysToExpiry={daysToExpiry}
            atmStrike={atmStrike}
            orderMode={orderMode}
            expiry={selectedExpiry}
            onToast={showToast}
            mode={strategyMode}
            onModeChange={setStrategyMode}
            volumeData={volumeData}
            avgVolume={avgVolume}
            flowByToken={flowByToken}
          />
        </div>
      )}
    </div>
  );
};

export default OptionChain;
