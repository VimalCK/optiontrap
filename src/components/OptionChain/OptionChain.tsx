import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import SellStrategy from '@/components/SellStrategy/SellStrategy';
import { atmStrikeOf, averageVolume, strikeWindow } from '../../../shared/optionAnalysis/chain.js';
import AppSelect from '@/components/AppSelect/AppSelect';
import IconButton from '@/components/IconButton/IconButton';
import { InfoIcon } from '@/components/icons/Icons';
import { calculateExpectedMove } from '@/services/edgeScore';
import { watchSnapshotSymbol, withSpot, getTodaySnapshots, getLatestSnapshotTimestamp, calculateVelocity, analyzeVelocityPattern, OiSnapshot, OiVelocity } from '@/services/oiSnapshots';
import { computeStrikeSignals } from '@/services/combinedSignal';
import { tradeErrorMessage } from '@/services/positions';
import { placeMarketTrade, placedOrderMessage, placedOrderRefused } from '@/services/orders';
import OrderModal from '@/components/OrderModal/OrderModal';
import { useOrderChoices } from '@/components/OrderModal/useOrderChoices';
import { computeLiveFlow, describeFlow, flowColor } from '@/services/oiFlow';
import { OiChartGuide, SellStrategyGuide, BuyStrategyGuide, PositionAnalyzerGuide } from './AnalyzerGuides';
import { ToastColor } from '@/utils/uiEnums';
import ToastStack from '@/components/Toast/ToastStack';
import { useToasts } from '@/hooks/useToasts';

const VOLUME_CONFIDENCE_LABELS: Record<ConfidenceId, string> = {
  [Confidence.High]: 'Confirmed',
  [Confidence.Medium]: 'Normal',
  [Confidence.Low]: 'Low Vol',
};

import { fetchQuotes, fetchPreviousDayOI } from '@/services/kiteApi';
import { isAbortError } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import {
  fetchOptions,
  getExpiries,
  buildOptionChain,
  OptionInstrument,
  OptionChainRow,
} from '@/services/optionChain';
import { fetchUnderlyings, type Underlying } from '@/services/underlyings';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe, tickerUpdateTokens } from '@/services/tickerSingleton';
import { formatCalendarDate, isMarketLive, istDaysUntil } from '@/utils/marketStatus';
import { Horizon, OptionType, type HorizonId, Side, TradingMode, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { Confidence, MoveDirection, OiFlow, oiFlowLabel, velocityTrendLabel, type ConfidenceId } from '../../../shared/analysisEnums.js';
import { StrategyMode, type StrategyModeId } from '../../../shared/appEnums.js';
import '@/styles/optionchain.css';

const RECENT_OPTION_SYMBOLS_KEY = 'optiontrap_option_analyzer_recent_symbols';
const MAX_RECENT_OPTION_SYMBOLS = 5;

function loadRecentOptionSymbols(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_OPTION_SYMBOLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, MAX_RECENT_OPTION_SYMBOLS)
      : [];
  } catch {
    return [];
  }
}

function saveRecentOptionSymbols(symbols: string[]): void {
  localStorage.setItem(RECENT_OPTION_SYMBOLS_KEY, JSON.stringify(symbols.slice(0, MAX_RECENT_OPTION_SYMBOLS)));
}

const OptionChain: React.FC = () => {
  // Cancels this tab's in-flight requests when the user navigates away.
  const signal = useAbortSignal();
  // The last symbol opened; none until the user picks one.
  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => loadRecentOptionSymbols()[0] ?? '');
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => loadRecentOptionSymbols());
  const [underlyings, setUnderlyings] = useState<Underlying[]>([]);
  const symbolOptions = useMemo(() => underlyings.map((u) => ({ value: u.name, label: u.label })), [underlyings]);
  // The selected symbol's price instrument (an index row or the stock's NSE row).
  const underlying = useMemo(() => underlyings.find((u) => u.name === selectedSymbol) ?? null, [underlyings, selectedSymbol]);
  const spotToken = underlying?.instrumentToken ?? null;
  const spotQuoteKey = underlying?.tradingsymbol ? `${underlying.exchange}:${underlying.tradingsymbol}` : null;
  const [options, setOptions] = useState<OptionInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [closePrices, setClosePrices] = useState<Map<number, number>>(new Map());
  const [oiData, setOiData] = useState<Map<number, number>>(new Map());
  const [volumeData, setVolumeData] = useState<Map<number, number>>(new Map());
  const [prevDayOi, setPrevDayOi] = useState<Map<number, number>>(new Map());
  const [spotPrice, setSpotPrice] = useState<number>(0);
  const [spotPrevClose, setSpotPrevClose] = useState<number>(0);
  const [selectedChartStrike, setSelectedChartStrike] = useState<number | null>(null);
  const [showOiChartInfo, setShowOiChartInfo] = useState(false);
  const [showSellStrategyInfo, setShowSellStrategyInfo] = useState(false);
  const [strategyMode, setStrategyMode] = useState<StrategyModeId>(StrategyMode.Sell);

  const [orderForm, setOrderForm] = useState<{ strike: number; optionType: OptionTypeId; price: number } | null>(null);
  const orderChoices = useOrderChoices();
  const orderMode = orderChoices.mode;
  const [oiVelocity, setOiVelocity] = useState<Map<number, OiVelocity>>(new Map());
  const [allSnapshots, setSnapshots] = useState<OiSnapshot[]>([]);
  const snapshots = useMemo(() => withSpot(allSnapshots, spotToken), [allSnapshots, spotToken]);
  const { toasts, showToast } = useToasts();
  const subscribedTokensRef = useRef<number[]>([]);
  const chainCardRef = useRef<HTMLDivElement>(null);
  const [oiChartWidth, setOiChartWidth] = useState(0);
  const oiChartObserverRef = useRef<ResizeObserver | null>(null);
  // Callback ref: the OI chart mounts/unmounts with loading state, so observe whenever it appears.
  const oiChartBarsRef = useCallback((el: HTMLDivElement | null) => {
    oiChartObserverRef.current?.disconnect();
    oiChartObserverRef.current = null;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setOiChartWidth(entry.contentRect.width));
    observer.observe(el);
    oiChartObserverRef.current = observer;
  }, []);
  const chainCardLockedHeight = useRef<number | null>(null);

  const selectSymbol = useCallback((nextSymbol: string) => {
    setSelectedSymbol(nextSymbol);
    setRecentSymbols((prev) => {
      const next = [nextSymbol, ...prev.filter((value) => value !== nextSymbol)].slice(0, MAX_RECENT_OPTION_SYMBOLS);
      saveRecentOptionSymbols(next);
      return next;
    });
  }, []);

  const recentSymbolOptions = useMemo(() => {
    const labels = new Map(symbolOptions.map((option) => [String(option.value), option.label]));
    return recentSymbols
      .filter((value) => value !== selectedSymbol)
      .map((value) => ({ value, label: labels.get(value) || value }));
  }, [recentSymbols, selectedSymbol, symbolOptions]);

  const placePaperTrade = useCallback(async ({
    instrument,
    strike,
    optionType,
    side,
    quantity,
    horizon,
  }: {
    instrument: OptionInstrument;
    strike: number;
    optionType: OptionTypeId;
    side: SideId;
    quantity: number;
    horizon: HorizonId;
  }) => {
    const placed = await placeMarketTrade({
      tradingsymbol: instrument.tradingsymbol,
      instrumentToken: instrument.instrumentToken,
      strike,
      optionType,
      side,
      quantity,
      expiry: selectedExpiry,
      horizon,
    });
    showToast(placedOrderMessage(placed, `${side} ${strike}${optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
  }, [selectedExpiry, showToast]);

  const handleTicks = useCallback((ticks: Tick[]) => {
    const spotTick = ticks.find((t) => t.instrumentToken === spotToken);
    if (spotTick) {
      setSpotPrice(spotTick.lastPrice);
      if (spotTick.closePrice && spotTick.closePrice > 0) setSpotPrevClose(spotTick.closePrice);
    }

    const priceTicks = ticks.filter((t) => t.instrumentToken !== spotToken);

    setLivePrices((prev) => {
      if (priceTicks.length === 0) return prev;
      const next = new Map(prev);
      priceTicks.forEach((t) => next.set(t.instrumentToken, t.lastPrice));
      return next;
    });

    setClosePrices((prev) => {
      const relevant = priceTicks.filter((t) => t.closePrice !== undefined && t.closePrice > 0);
      if (relevant.length === 0) return prev;
      const next = new Map(prev);
      relevant.forEach((t) => next.set(t.instrumentToken, t.closePrice!));
      return next;
    });

    setOiData((prev) => {
      const relevant = priceTicks.filter((t) => t.oi !== undefined);
      if (relevant.length === 0) return prev;
      const next = new Map(prev);
      relevant.forEach((t) => next.set(t.instrumentToken, t.oi!));
      return next;
    });

    setVolumeData((prev) => {
      const relevant = priceTicks.filter((t) => t.volume !== undefined);
      if (relevant.length === 0) return prev;
      const next = new Map(prev);
      relevant.forEach((t) => next.set(t.instrumentToken, t.volume!));
      return next;
    });
  }, [spotToken]);

  useEffect(() => {
    fetchUnderlyings(signal).then(setUnderlyings).catch((err) => {
      if (!isAbortError(err)) console.error('[Option Analyzer] Could not load symbols:', err);
    });
  }, []);

  useEffect(() => {
    if (selectedSymbol) loadOptions();
  }, [selectedSymbol]);

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOptions(selectedSymbol, signal);
      setOptions(data);
      const expiries = getExpiries(data);
      if (expiries.length > 0) {
        setSelectedExpiry(expiries[0]);
      }
      setSpotPrevClose(0);
    } catch (err) {
      if (isAbortError(err)) return;
      const msg = err instanceof Error ? err.message : 'Failed to load option chain';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const expiries = useMemo(() => getExpiries(options), [options]);
  const chain: OptionChainRow[] = useMemo(
    () => (selectedExpiry ? buildOptionChain(options, selectedExpiry) : []),
    [options, selectedExpiry],
  );

  // ATM is the strike closest to spot (shared with the trade engine's Option Analyzer setups).
  const atmStrike = useMemo(() => atmStrikeOf(chain, spotPrice), [chain, spotPrice]);

  // Show exactly 31 strikes centred on ATM (±15). When ATM is near an edge,
  // the window shifts rather than shrinks — count stays fixed so the table
  // height never jumps as ATM changes.
  const visibleChain = useMemo(() => strikeWindow(chain, atmStrike), [chain, atmStrike]);

  const maxOi = useMemo(() => {
    let max = 0;
    visibleChain.forEach((row) => {
      const ceOi = row.ce ? oiData.get(row.ce.instrumentToken) || 0 : 0;
      const peOi = row.pe ? oiData.get(row.pe.instrumentToken) || 0 : 0;
      if (ceOi > max) max = ceOi;
      if (peOi > max) max = peOi;
    });
    return max;
  }, [visibleChain, oiData]);

  const avgVolume = useMemo(() => averageVolume(visibleChain, volumeData), [visibleChain, volumeData]);

  // IV-based flow per option against the previous close (shown alongside OI + Price, not scored)
  const flowByToken = useMemo(
    () => computeLiveFlow(chain, oiData, prevDayOi, livePrices, closePrices, spotPrice, spotPrevClose || undefined, volumeData),
    [chain, oiData, prevDayOi, livePrices, closePrices, spotPrice, spotPrevClose, volumeData],
  );

  const strikeSignals = useMemo(
    () => computeStrikeSignals(visibleChain, oiData, livePrices, snapshots, volumeData, avgVolume),
    [visibleChain, oiData, livePrices, snapshots, volumeData, avgVolume]
  );

  const daysToExpiry = useMemo(() => {
    if (!selectedExpiry) return undefined;
    return Math.max(0, istDaysUntil(selectedExpiry));
  }, [selectedExpiry]);

  const expectedMove = useMemo(
    () => calculateExpectedMove(visibleChain, atmStrike, livePrices),
    [visibleChain, atmStrike, livePrices],
  );

  const prevOiFetchedRef = useRef<string>('');
  useEffect(() => {
    if (visibleChain.length === 0) return;

    const tokens: number[] = [];
    visibleChain.forEach((row) => {
      if (row.ce) tokens.push(row.ce.instrumentToken);
      if (row.pe) tokens.push(row.pe.instrumentToken);
    });
    const fetchKey = tokens.join(',');
    if (prevOiFetchedRef.current === fetchKey) return;
    prevOiFetchedRef.current = fetchKey;

    const abortController = new AbortController();

    fetchPreviousDayOI(
      tokens,
      // Update state after each batch so OI% appears as data arrives
      (partial) => { setPrevDayOi(partial); },
      abortController.signal,
    ).then((prevOi) => {
      if (!abortController.signal.aborted && prevOi.size > 0) {
        setPrevDayOi(prevOi);
      }
    }).catch((err) => {
      if (!abortController.signal.aborted) {
        console.warn('[OptionChain] Failed to fetch previous day OI:', err);
      }
    });

    return () => {
      abortController.abort();
      prevOiFetchedRef.current = '';
    };
  }, [visibleChain]);

  // Subscribe only during market hours.
  useEffect(() => {
    if (visibleChain.length === 0 || !isMarketLive()) return;

    const tokens: number[] = spotToken !== null ? [spotToken] : [];
    visibleChain.forEach((row) => {
      if (row.ce) tokens.push(row.ce.instrumentToken);
      if (row.pe) tokens.push(row.pe.instrumentToken);
    });

    // Reconnect only when the token set changes.
    const prevTokens = subscribedTokensRef.current;
    const tokensChanged = tokens.length !== prevTokens.length ||
      tokens.some((t, i) => t !== prevTokens[i]);

    if (tokensChanged) {
      tickerUpdateTokens('option-chain', tokens);
      subscribedTokensRef.current = tokens;
    }

    const unsub = tickerSubscribe('option-chain', tokens, handleTicks);
    subscribedTokensRef.current = tokens;
    return unsub;
  }, [visibleChain, handleTicks]);

  // OI snapshots are taken by the server (the always-snapshot symbols, plus
  // others once opened here). Register the selected symbol, then load today's snapshots.
  const latestSnapshotTsRef = useRef<number | null>(null);
  const loadSnapshots = useCallback(async () => {
    const snaps = await getTodaySnapshots(signal);
    latestSnapshotTsRef.current = snaps.length > 0 ? snaps[snaps.length - 1].timestamp : null;
    setSnapshots(snaps);
  }, [signal]);

  useEffect(() => {
    if (!selectedSymbol) return;
    watchSnapshotSymbol(selectedSymbol, signal)
      .then(loadSnapshots)
      .catch((err) => { if (!isAbortError(err)) console.error('[OI Snapshots] Load failed:', err); });
  }, [selectedSymbol, loadSnapshots]);

  // During market hours, pick up each new server snapshot (one per 10 minutes).
  useEffect(() => {
    const poll = async () => {
      if (!isMarketLive()) return;
      try {
        const latest = await getLatestSnapshotTimestamp(signal);
        if (latest !== null && latest !== latestSnapshotTsRef.current) await loadSnapshots();
      } catch (err) {
        if (!isAbortError(err)) console.warn('[OI Snapshots] Poll failed:', err);
      }
    };
    const id = setInterval(poll, 60 * 1000);
    return () => clearInterval(id);
  }, [loadSnapshots]);

  // Lock option chain card height after strikes are loaded to prevent jerk
  useEffect(() => {
    if (visibleChain.length > 0 && chainCardRef.current && chainCardLockedHeight.current === null) {
      requestAnimationFrame(() => {
        if (chainCardRef.current) {
          chainCardLockedHeight.current = chainCardRef.current.offsetHeight;
          chainCardRef.current.style.minHeight = `${chainCardLockedHeight.current}px`;
        }
      });
    }
  }, [visibleChain.length]);

  useEffect(() => {
    if (snapshots.length > 0 && oiData.size > 0) {
      setOiVelocity(calculateVelocity(oiData, snapshots));
    }
  }, [oiData, snapshots]);

  // Market closed: fetch quotes when chain is ready.
  // Two-phase approach: first fetch the spot to determine correct ATM,
  // then fetch all option strikes around the real ATM.
  const quoteFetchedRef = useRef<string>('');
  useEffect(() => {
    if (chain.length === 0 || isMarketLive()) return;

    const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
    const start = Math.max(0, atmIndex - 15);
    const end = Math.min(chain.length, atmIndex + 16);
    const strikes = chain.slice(start, end);
    // The spot key is part of it: the symbol list (and so the spot) may arrive after the chain.
    const fetchKey = `${spotQuoteKey}_${selectedExpiry}_${strikes[0]?.strike}_${strikes[strikes.length - 1]?.strike}`;

    if (quoteFetchedRef.current === fetchKey) return;
    quoteFetchedRef.current = fetchKey;

    const instruments: string[] = spotQuoteKey ? [spotQuoteKey] : [];
    strikes.forEach((row) => {
      if (row.ce) instruments.push(`NFO:${row.ce.tradingsymbol}`);
      if (row.pe) instruments.push(`NFO:${row.pe.tradingsymbol}`);
    });

    fetchQuotes(instruments, signal).then((quotes) => {
      const priceMap = new Map<number, number>();
      const oiMap = new Map<number, number>();
      const closeMap = new Map<number, number>();
      strikes.forEach((row) => {
        if (row.ce) {
          const q = quotes.get(`NFO:${row.ce.tradingsymbol}`);
          if (q) {
            priceMap.set(row.ce.instrumentToken, q.last_price);
            oiMap.set(row.ce.instrumentToken, q.oi);
            if (q.ohlc.close > 0) closeMap.set(row.ce.instrumentToken, q.ohlc.close);
          }
        }
        if (row.pe) {
          const q = quotes.get(`NFO:${row.pe.tradingsymbol}`);
          if (q) {
            priceMap.set(row.pe.instrumentToken, q.last_price);
            oiMap.set(row.pe.instrumentToken, q.oi);
            if (q.ohlc.close > 0) closeMap.set(row.pe.instrumentToken, q.ohlc.close);
          }
        }
      });
      setLivePrices(priceMap);
      setOiData(oiMap);
      setClosePrices(closeMap);

      const spotQuote = spotQuoteKey ? quotes.get(spotQuoteKey) : undefined;
      if (spotQuote) {
        setSpotPrice(spotQuote.last_price);
        if (spotQuote.ohlc.close > 0) setSpotPrevClose(spotQuote.ohlc.close);
      }

      const missing: string[] = [];
      strikes.forEach((row) => {
        if (row.ce && !quotes.has(`NFO:${row.ce.tradingsymbol}`)) missing.push(`NFO:${row.ce.tradingsymbol}`);
        if (row.pe && !quotes.has(`NFO:${row.pe.tradingsymbol}`)) missing.push(`NFO:${row.pe.tradingsymbol}`);
      });
      if (missing.length > 0) console.warn(`[Trades] Missing quotes for: ${missing.join(', ')}`);

    }).catch((err) => {
      if (isAbortError(err)) return;
      console.error('[Trades] Failed to fetch quotes:', err);
      // Reset so it can retry
      quoteFetchedRef.current = '';
      // Fallback to latest server OI snapshot
      getTodaySnapshots(signal).then((snaps) => {
        if (snaps.length > 0) {
          const [latest] = withSpot(snaps.slice(-1), spotToken);
          if (latest.prices) setLivePrices(new Map(Object.entries(latest.prices).map(([k, v]) => [Number(k), v])));
          if (latest.data) setOiData(new Map(Object.entries(latest.data).map(([k, v]) => [Number(k), v])));
          if (latest.close) setClosePrices(new Map(Object.entries(latest.close).map(([k, v]) => [Number(k), v])));
          if (latest.spot) setSpotPrice(latest.spot);
        }
      }).catch(() => { /* cancelled */ });
    });
  }, [chain, atmStrike, selectedExpiry, spotQuoteKey]);

  const getPrice = (instrument: OptionInstrument | null): number | null => {
    if (!instrument) return null;
    const live = livePrices.get(instrument.instrumentToken);
    return live !== undefined && live > 0 ? live : null;
  };

  // Helper to get % change from previous day's close price (same as Zerodha)
  const getPriceChange = (instrument: OptionInstrument | null): { pct: number; color: string } | null => {
    if (!instrument) return null;
    const ltp = livePrices.get(instrument.instrumentToken);
    const prevClose = closePrices.get(instrument.instrumentToken);
    if (ltp === undefined || prevClose === undefined || prevClose === 0) return null;
    const pct = ((ltp - prevClose) / prevClose) * 100;
    const color = pct > 0 ? 'positive' : pct < 0 ? 'negative' : '';
    return { pct, color };
  };

  const getOiChange = (instrument: OptionInstrument | null): { pct: number; color: string } | null => {
    if (!instrument) return null;
    const currentOi = oiData.get(instrument.instrumentToken);
    const prevOi = prevDayOi.get(instrument.instrumentToken);
    if (currentOi === undefined || prevOi === undefined || prevOi === 0) return null;
    const pct = ((currentOi - prevOi) / prevOi) * 100;
    const color = pct > 0 ? 'positive' : pct < 0 ? 'negative' : '';
    return { pct, color };
  };

  const renderTooltipSide = (
    side: OptionTypeId,
    option: OptionChainRow['ce'],
    oi: number,
    prevOi: number,
    velocity: OiVelocity | undefined,
  ) => {
    const flow = option ? flowByToken.get(option.instrumentToken) : undefined;
    const pattern = option && velocity ? analyzeVelocityPattern(option.instrumentToken, velocity.currentOi, snapshots) : null;
    const chgPct = prevOi > 0 ? ((oi - prevOi) / prevOi) * 100 : null;
    const sideClass = side === OptionType.CE ? 'ce' : 'pe';
    return (
      <div className={`oc-tip__side oc-tip__side--${sideClass}`}>
        <div className="oc-tip__side-title">{side === OptionType.CE ? 'Calls' : 'Puts'}</div>
        <div className="oc-tip__row">
          <span>OI</span>
          <span>{oi.toLocaleString('en-IN')}</span>
        </div>
        {chgPct !== null && (
          <div className="oc-tip__row">
            <span>Chg</span>
            <span className={chgPct >= 0 ? 'positive' : 'negative'}>{chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%</span>
          </div>
        )}
        {flow && flow.flow !== OiFlow.None && (
          <div className="oc-tip__row oc-tip__row--flow" title={describeFlow(flow).join('\n')}>
            <span>IV flow</span>
            <span className="oc-tip__flow">
              <span style={{ color: flowColor(flow.flow) }}>{oiFlowLabel(flow.flow)}</span>
              {flow.relIvChange !== null && (
                <span className="oc-tip__sub">{flow.relIvChange >= 0 ? '+' : ''}{(flow.relIvChange * 100).toFixed(1)} IV vs ATM</span>
              )}
            </span>
          </div>
        )}
        {velocity && (
          <div className="oc-tip__row">
            <span>Velocity</span>
            <span className={velocity.changePct >= 0 ? 'positive' : 'negative'}>{velocity.changePct >= 0 ? '+' : ''}{velocity.changePct.toFixed(2)}% / {velocity.intervalMinutes}m</span>
          </div>
        )}
        {pattern && (
          <div className="oc-tip__pattern">
            <svg className="oc-chart__sparkline" viewBox="0 0 60 20" preserveAspectRatio="none">
              <polyline
                points={pattern.series.map((v, i) => `${(i / (pattern.series.length - 1)) * 60},${(1 - v) * 20}`).join(' ')}
                fill="none"
                stroke={pattern.direction === MoveDirection.Up ? '#4ade80' : pattern.direction === MoveDirection.Down ? '#f87171' : '#94a3b8'}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span className={`oc-chart__pattern-label oc-chart__pattern-label--${pattern.direction.toLowerCase()}`}>{velocityTrendLabel(pattern.trend)}</span>
          </div>
        )}
      </div>
    );
  };

  // Strike columns shrink to the card width, so thin out strike labels to avoid overlap.
  const chartColWidth = oiChartWidth > 0 && visibleChain.length > 0 ? oiChartWidth / visibleChain.length : 0;
  const strikeLabelStep = chartColWidth > 0 ? Math.max(2, Math.ceil(36 / chartColWidth)) : 2;

  return (
    <div>
      <ToastStack toasts={toasts} />
      {(expiries.length > 0 || !selectedSymbol) && (
        <div className="oc-expiry-panel">
          <div className="oc-expiry-bar">
            <AppSelect
              value={selectedSymbol}
              options={symbolOptions}
              onChange={(v) => selectSymbol(String(v))}
              placeholder="Select symbol"
              searchable
            />
            {expiries.length > 0 && (
              <>
                <span className="oc-expiry-bar__label">Expiry</span>
                <AppSelect
                  value={selectedExpiry}
                  options={expiries.map((exp) => ({
                    value: exp,
                    label: formatCalendarDate(exp, { day: '2-digit', month: 'short', year: 'numeric' }),
                  }))}
                  onChange={(v) => setSelectedExpiry(String(v))}
                  className="oc-expiry-select"
                />
              </>
            )}
            {daysToExpiry !== undefined && (
              <span className="oc-expiry-bar__days">{daysToExpiry === 0 ? 'Expiry today' : `${daysToExpiry}d to expiry`}</span>
            )}
          </div>

          {recentSymbolOptions.length > 0 && (
            <div className="oc-recent-symbols" aria-label="Recently visited stocks">
              <span className="oc-recent-symbols__label">Recent</span>
              {recentSymbolOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="oc-recent-symbols__chip"
                  onClick={() => selectSymbol(option.value)}
                  title={`Switch to ${option.label}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card option-chain-card" ref={chainCardRef}>

        {loading && (
          <div className="holdings-loading">
            <div className="redirect-spinner" />
            <p>Loading option chain...</p>
          </div>
        )}

        {error && (
          <div className="holdings-error" style={{ padding: 16 }}>
            <p>{error}</p>
            <button className="btn btn--primary" onClick={loadOptions} style={{ marginTop: 12 }}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && visibleChain.length > 0 && (
          <div className="option-chain-table-wrapper">
            <table className="option-chain-table">
              <colgroup>
                <col className="oc-col-oi" />
                <col className="oc-col-ltp" />
                <col className="oc-col-strike" />
                <col className="oc-col-ltp" />
                <col className="oc-col-oi" />
              </colgroup>
              <thead>
                <tr>
                  <th className="oc-header-ce" colSpan={2}>CALLS</th>
                  <th className="oc-header-strike">STRIKE</th>
                  <th className="oc-header-pe" colSpan={2}>PUTS</th>
                </tr>
                <tr>
                  <th>OI</th>
                  <th>LTP</th>
                  <th></th>
                  <th>LTP</th>
                  <th>OI</th>
                </tr>
              </thead>
              <tbody>
                {visibleChain.map((row) => {
                  const isAtm = row.strike === atmStrike;
                  const ceItm = row.strike < atmStrike;
                  const peItm = row.strike > atmStrike;
                  const cePrice = getPrice(row.ce);
                  const pePrice = getPrice(row.pe);
                  const ceOi = row.ce ? oiData.get(row.ce.instrumentToken) : undefined;
                  const peOi = row.pe ? oiData.get(row.pe.instrumentToken) : undefined;
                  const ceChg = getPriceChange(row.ce);
                  const peChg = getPriceChange(row.pe);
                  const ceOiChg = getOiChange(row.ce);
                  const peOiChg = getOiChange(row.pe);
                  const isOrderOpen = orderForm?.strike === row.strike;
                  return (
                    <tr key={row.strike} className={`${isAtm ? 'oc-row--atm' : ''} ${isOrderOpen ? 'oc-row--active' : ''}`} style={{ position: 'relative' }}>
                      <td className={`oc-cell-oi oc-cell-oi--ce ${ceItm ? 'oc-cell--itm-ce' : ''}`}>
                        <span className="oc-oi-content">
                          {ceOi !== undefined ? ceOi.toLocaleString('en-IN') : '-'}
                          {ceOiChg && <span className={`oc-cell-chg ${ceOiChg.color}`}>{ceOiChg.pct >= 0 ? '+' : ''}{ceOiChg.pct.toFixed(2)}%</span>}
                        </span>
                      </td>
                      <td className={`oc-cell-ltp oc-cell-ltp--clickable oc-cell-ltp--hover-btns ${ceItm ? 'oc-cell--itm-ce' : ''}`} onClick={() => setOrderForm(isOrderOpen && orderForm?.optionType === OptionType.CE ? null : { strike: row.strike, optionType: OptionType.CE, price: cePrice ?? 0 })}>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--buy" onClick={async (e) => { e.stopPropagation(); if (!row.ce || cePrice === null || orderMode !== TradingMode.Paper) return; try { await placePaperTrade({ instrument: row.ce, strike: row.strike, optionType: OptionType.CE, side: Side.BUY, quantity: row.ce.lotSize, horizon: Horizon.Intraday }); } catch (err) { showToast(tradeErrorMessage(err), ToastColor.Red); } }}>B</button>
                        <span className="oc-ltp-price">
                          {cePrice !== null ? cePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                          {ceChg && <span className={`oc-cell-chg ${ceChg.color}`}>{ceChg.pct >= 0 ? '+' : ''}{ceChg.pct.toFixed(2)}%</span>}
                        </span>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--sell" onClick={async (e) => { e.stopPropagation(); if (!row.ce || cePrice === null || orderMode !== TradingMode.Paper) return; try { await placePaperTrade({ instrument: row.ce, strike: row.strike, optionType: OptionType.CE, side: Side.SELL, quantity: row.ce.lotSize, horizon: Horizon.Intraday }); } catch (err) { showToast(tradeErrorMessage(err), ToastColor.Red); } }}>S</button>
                      </td>
                      <td className="oc-cell-strike">
                        <div className="oc-strike-bars">
                          <div className="oc-oi-bar oc-oi-bar--ce" style={{ width: `${maxOi > 0 && ceOi ? (ceOi / maxOi) * 50 : 0}%` }} />
                          <div className="oc-oi-bar oc-oi-bar--pe" style={{ width: `${maxOi > 0 && peOi ? (peOi / maxOi) * 50 : 0}%` }} />
                        </div>
                        {row.strike}
                      </td>
                      <td className={`oc-cell-ltp oc-cell-ltp--clickable oc-cell-ltp--hover-btns ${peItm ? 'oc-cell--itm-pe' : ''}`} onClick={() => setOrderForm(isOrderOpen && orderForm?.optionType === OptionType.PE ? null : { strike: row.strike, optionType: OptionType.PE, price: pePrice ?? 0 })}>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--buy" onClick={async (e) => { e.stopPropagation(); if (!row.pe || pePrice === null || orderMode !== TradingMode.Paper) return; try { await placePaperTrade({ instrument: row.pe, strike: row.strike, optionType: OptionType.PE, side: Side.BUY, quantity: row.pe.lotSize, horizon: Horizon.Intraday }); } catch (err) { showToast(tradeErrorMessage(err), ToastColor.Red); } }}>B</button>
                        <span className="oc-ltp-price">
                          {pePrice !== null ? pePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                          {peChg && <span className={`oc-cell-chg ${peChg.color}`}>{peChg.pct >= 0 ? '+' : ''}{peChg.pct.toFixed(2)}%</span>}
                        </span>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--sell" onClick={async (e) => { e.stopPropagation(); if (!row.pe || pePrice === null || orderMode !== TradingMode.Paper) return; try { await placePaperTrade({ instrument: row.pe, strike: row.strike, optionType: OptionType.PE, side: Side.SELL, quantity: row.pe.lotSize, horizon: Horizon.Intraday }); } catch (err) { showToast(tradeErrorMessage(err), ToastColor.Red); } }}>S</button>
                      </td>
                      <td className={`oc-cell-oi oc-cell-oi--pe ${peItm ? 'oc-cell--itm-pe' : ''}`}>
                        <span className="oc-oi-content">
                          {peOi !== undefined ? peOi.toLocaleString('en-IN') : '-'}
                          {peOiChg && <span className={`oc-cell-chg ${peOiChg.color}`}>{peOiChg.pct >= 0 ? '+' : ''}{peOiChg.pct.toFixed(2)}%</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!selectedSymbol && (
          <p className="card__description" style={{ marginTop: 16 }}>
            Select a symbol to see its option chain.
          </p>
        )}

        {selectedSymbol && !loading && !error && options.length === 0 && (
          <p className="card__description" style={{ marginTop: 16 }}>
            No option data available.
          </p>
        )}
      </div>

      {orderForm && (() => {
        const row = visibleChain.find((r) => r.strike === orderForm.strike);
        const instrument = orderForm.optionType === OptionType.CE ? row?.ce : row?.pe;
        if (!instrument) return null;
        return (
          <OrderModal
            key={`${orderForm.strike}${orderForm.optionType}`}
            option={{ tradingsymbol: instrument.tradingsymbol, instrumentToken: instrument.instrumentToken, lotSize: instrument.lotSize, strike: orderForm.strike, optionType: orderForm.optionType, expiry: selectedExpiry }}
            initialPrice={orderForm.price}
            priceLabel="LTP"
            choices={orderChoices}
            onClose={() => setOrderForm(null)}
            onToast={showToast}
          />
        );
      })()}

      {!loading && !error && visibleChain.length > 0 && (
        <div className={`card oc-chart-card ${selectedChartStrike !== null ? 'oc-chart-card--tooltip-open' : ''}`} style={{ marginTop: 'var(--card-gap)' }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <h3 className="card__title" style={{ marginBottom: 0 }}>OI Chart <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)' }}>(daily changes)</span></h3>
              <IconButton icon={<InfoIcon />} label="How to read this chart" onClick={() => setShowOiChartInfo(!showOiChartInfo)} expanded={showOiChartInfo} />
            </div>
          </div>
          {showOiChartInfo && <OiChartGuide />}
          <div className="oc-chart">
            <div className="oc-chart__body">
              <div className="oc-chart__yaxis">
                {[...Array(9)].map((_, i) => {
                  const value = maxOi * (8 - i) / 8;
                  let label = '0';
                  if (value > 0) {
                    if (value >= 10000000) label = `${(value / 10000000).toFixed(1)}Cr`;
                    else if (value >= 100000) label = `${(value / 100000).toFixed(1)}L`;
                    else label = `${(value / 1000).toFixed(0)}K`;
                  }
                  return <span key={i}>{label}</span>;
                })}
              </div>
              <div className="oc-chart__main">
              <div className="oc-chart__bars" ref={oiChartBarsRef} onClick={() => setSelectedChartStrike(null)}>
                <div className="oc-chart__gridlines">
                  {[...Array(9)].map((_, i) => (
                    <div key={i} className="oc-chart__gridline" style={{ top: `${(i / 8) * 100}%` }} />
                  ))}
                </div>
                {expectedMove > 0 && spotPrice > 0 && (() => {
                  const totalStrikes = visibleChain.length;
                  if (totalStrikes < 2) return null;
                  let startIdx = -1;
                  let endIdx = -1;
                  for (let i = 0; i < totalStrikes; i++) {
                    const s = visibleChain[i].strike;
                    if (s >= (spotPrice - expectedMove) && s <= (spotPrice + expectedMove)) {
                      if (startIdx === -1) startIdx = i;
                      endIdx = i;
                    }
                  }
                  if (startIdx === -1) return null;
                  const left = (startIdx / totalStrikes) * 100;
                  const right = 100 - ((endIdx + 1) / totalStrikes) * 100;
                  return <div className="oc-chart__expected-range" style={{ left: `${left}%`, right: `${right}%` }} />;
                })()}
              {visibleChain.map((row) => {
                const ceOi = row.ce ? oiData.get(row.ce.instrumentToken) || 0 : 0;
                const peOi = row.pe ? oiData.get(row.pe.instrumentToken) || 0 : 0;
                const cePrevOi = row.ce ? prevDayOi.get(row.ce.instrumentToken) || 0 : 0;
                const pePrevOi = row.pe ? prevDayOi.get(row.pe.instrumentToken) || 0 : 0;
                const ceHeight = maxOi > 0 ? (ceOi / maxOi) * 100 : 0;
                const peHeight = maxOi > 0 ? (peOi / maxOi) * 100 : 0;
                const cePrevHeight = maxOi > 0 ? (Math.min(cePrevOi, ceOi) / maxOi) * 100 : 0;
                const pePrevHeight = maxOi > 0 ? (Math.min(pePrevOi, peOi) / maxOi) * 100 : 0;
                const ceDecreased = cePrevOi > ceOi && maxOi > 0;
                const peDecreased = pePrevOi > peOi && maxOi > 0;
                const cePrevMarker = ceDecreased ? (cePrevOi / maxOi) * 100 : 0;
                const pePrevMarker = peDecreased ? (pePrevOi / maxOi) * 100 : 0;
                const isAtm = row.strike === atmStrike;
                const ceVelocity = row.ce ? oiVelocity.get(row.ce.instrumentToken) : undefined;
                const peVelocity = row.pe ? oiVelocity.get(row.pe.instrumentToken) : undefined;
                const ceVolume = row.ce ? volumeData.get(row.ce.instrumentToken) || 0 : 0;
                const peVolume = row.pe ? volumeData.get(row.pe.instrumentToken) || 0 : 0;
                const ceOiChanged = cePrevOi > 0 && Math.abs(ceOi - cePrevOi) / cePrevOi > 0.03;
                const peOiChanged = pePrevOi > 0 && Math.abs(peOi - pePrevOi) / pePrevOi > 0.03;
                const ceConfirmed = ceOiChanged && ceVolume > avgVolume * 1.5;
                const peConfirmed = peOiChanged && peVolume > avgVolume * 1.5;
                const ceLtp = row.ce ? (livePrices.get(row.ce.instrumentToken) ?? null) : null;
                const peLtp = row.pe ? (livePrices.get(row.pe.instrumentToken) ?? null) : null;
                return (
                  <div key={row.strike} className={`oc-chart__col ${isAtm ? 'oc-chart__col--atm' : ''} ${selectedChartStrike === row.strike ? 'oc-chart__col--selected' : ''}`} onClick={(e) => { e.stopPropagation(); setSelectedChartStrike(selectedChartStrike === row.strike ? null : row.strike); }}>
                    {selectedChartStrike === row.strike && (() => {
                      let maxBarPct = 0;
                      visibleChain.forEach((r) => {
                        const ce = r.ce ? oiData.get(r.ce.instrumentToken) || 0 : 0;
                        const pe = r.pe ? oiData.get(r.pe.instrumentToken) || 0 : 0;
                        const pct = maxOi > 0 ? (Math.max(ce, pe) / maxOi) * 100 : 0;
                        if (pct > maxBarPct) maxBarPct = pct;
                      });
                      // Position tooltip above the tallest bar (bar-group is 180px, column is 320px)
                      // bottom offset = (maxBarPct% of 180px) + 12px gap, relative to column bottom
                      const bottomPx = (maxBarPct / 100) * 180 + 16;
                      return (
                      <div className="oc-chart__tooltip" style={{ bottom: `${bottomPx}px` }}>
                        <div className="oc-tip__header">
                          <span className="oc-tip__strike">{row.strike}{isAtm && <span className="oc-tip__atm">ATM</span>}</span>
                          <span className="oc-tip__pcr">PCR <strong>{ceOi > 0 ? (peOi / ceOi).toFixed(2) : '-'}</strong></span>
                        </div>
                        {renderTooltipSide(OptionType.CE, row.ce, ceOi, cePrevOi, ceVelocity)}
                        {renderTooltipSide(OptionType.PE, row.pe, peOi, pePrevOi, peVelocity)}
                        {(() => {
                          const signal = strikeSignals.get(row.strike);
                          return signal ? (
                            <div className="oc-tip__signal">
                              <div className="oc-tip__row">
                                <span>Signal</span>
                                <span style={{ color: signal.color, fontWeight: 600 }}>{signal.label}</span>
                              </div>
                              {signal.confidence && (
                                <div className="oc-tip__row">
                                  <span>Volume</span>
                                  <span className={`oc-chart__tooltip-confidence oc-chart__tooltip-confidence--${signal.confidence.toLowerCase()}`}>
                                    {VOLUME_CONFIDENCE_LABELS[signal.confidence]}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : null;
                        })()}
                        {orderMode === TradingMode.Paper && (
                          <div className="oc-chart__tooltip-actions">
                            <button
                              className="oc-chart__tooltip-sell-btn oc-chart__tooltip-sell-btn--pe"
                              disabled={!row.pe || peLtp === null}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!row.pe || peLtp === null) return;
                                try {
                                  await placePaperTrade({ instrument: row.pe, strike: row.strike, optionType: OptionType.PE, side: Side.SELL, quantity: row.pe.lotSize, horizon: Horizon.Intraday });
                                  setSelectedChartStrike(null);
                                } catch (err) { showToast(tradeErrorMessage(err), ToastColor.Red); }
                              }}
                            >Sell PE {peLtp !== null ? `@ ${peLtp.toFixed(0)}` : ''}</button>
                            <button
                              className="oc-chart__tooltip-sell-btn oc-chart__tooltip-sell-btn--ce"
                              disabled={!row.ce || ceLtp === null}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!row.ce || ceLtp === null) return;
                                try {
                                  await placePaperTrade({ instrument: row.ce, strike: row.strike, optionType: OptionType.CE, side: Side.SELL, quantity: row.ce.lotSize, horizon: Horizon.Intraday });
                                  setSelectedChartStrike(null);
                                } catch (err) { showToast(tradeErrorMessage(err), ToastColor.Red); }
                              }}
                            >Sell CE {ceLtp !== null ? `@ ${ceLtp.toFixed(0)}` : ''}</button>
                          </div>
                        )}
                      </div>
                      );
                    })()}
                    {(ceVelocity?.isHigh || peVelocity?.isHigh) && (
                      <div className="oc-chart__velocity-stack">
                        {ceVelocity?.isHigh && (
                          <span className={`oc-chart__velocity oc-chart__velocity--ce ${ceVelocity.changePct > 0 ? 'oc-chart__velocity--up' : 'oc-chart__velocity--down'}`}>
                            {ceVelocity.changePct > 0 ? '▲' : '▼'}
                          </span>
                        )}
                        {peVelocity?.isHigh && (
                          <span className={`oc-chart__velocity oc-chart__velocity--pe ${peVelocity.changePct > 0 ? 'oc-chart__velocity--up' : 'oc-chart__velocity--down'}`}>
                            {peVelocity.changePct > 0 ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="oc-chart__bar-group">
                      <div className="oc-chart__bar-wrapper">
                        {peDecreased && <div className="oc-chart__bar-prev oc-chart__bar-prev--pe" style={{ height: `${pePrevMarker}%` }} />}
                        <div className={`oc-chart__bar oc-chart__bar--pe ${peConfirmed ? 'oc-chart__bar--confirmed' : ''}`} style={{ height: `${peHeight}%` }}>
                          {peOi > pePrevOi && pePrevOi > 0 && <div className="oc-chart__bar-added oc-chart__bar-added--pe" style={{ height: `${((peHeight - pePrevHeight) / peHeight) * 100}%` }} />}
                        </div>
                      </div>
                      <div className="oc-chart__bar-wrapper">
                        {ceDecreased && <div className="oc-chart__bar-prev oc-chart__bar-prev--ce" style={{ height: `${cePrevMarker}%` }} />}
                        <div className={`oc-chart__bar oc-chart__bar--ce ${ceConfirmed ? 'oc-chart__bar--confirmed' : ''}`} style={{ height: `${ceHeight}%` }}>
                          {ceOi > cePrevOi && cePrevOi > 0 && <div className="oc-chart__bar-added oc-chart__bar-added--ce" style={{ height: `${((ceHeight - cePrevHeight) / ceHeight) * 100}%` }} />}
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
            <div className="oc-chart__signal-heatmap">
              {visibleChain.map((row) => {
                const signal = strikeSignals.get(row.strike);
                return (
                  <div
                    key={row.strike}
                    className={`oc-chart__heatmap-cell${signal?.weak ? ' oc-chart__heatmap-cell--weak' : ''}`}
                    style={signal ? { background: signal.color } : undefined}
                  />
                );
              })}
            </div>
            <div className="oc-chart__strike-labels">
              {visibleChain.map((row, idx) => (
                <span key={row.strike} className="oc-chart__strike-labels-item">
                  {idx % strikeLabelStep === 0 ? row.strike : ''}
                </span>
              ))}
            </div>
            </div>
            </div>
            <div className="oc-chart__legend">
              <span className="oc-chart__legend-item oc-chart__legend-item--ce"><span className="oc-chart__legend-dot oc-chart__legend-dot--ce"></span>CE OI</span>
              <span className="oc-chart__legend-item oc-chart__legend-item--pe"><span className="oc-chart__legend-dot oc-chart__legend-dot--pe"></span>PE OI</span>
              {expectedMove > 0 && <span className="oc-chart__legend-item"><span className="oc-chart__legend-dot oc-chart__legend-dot--range"></span>Expected Range</span>}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && visibleChain.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--card-gap)' }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <h3 className="card__title" style={{ marginBottom: 0 }}>Strategy</h3>
              <IconButton icon={<InfoIcon />} label="How this works" onClick={() => setShowSellStrategyInfo(!showSellStrategyInfo)} expanded={showSellStrategyInfo} />
            </div>
          </div>
          {showSellStrategyInfo && (
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