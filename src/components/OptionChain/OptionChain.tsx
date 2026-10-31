import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import SellStrategy from '@/components/SellStrategy/SellStrategy';
import AppSelect from '@/components/AppSelect/AppSelect';
import { calculateExpectedMove } from '@/services/edgeScore';
import { saveOiSnapshot, getTodaySnapshots, calculateVelocity, shouldTakeSnapshot, analyzeVelocityPattern, OiSnapshot, OiVelocity } from '@/services/oiSnapshots';
import { computeStrikeSignals } from '@/services/combinedSignal';
import { addPosition } from '@/services/positions';
import { computeLiveFlow, describeFlow, flowColor } from '@/services/oiFlow';
import { OiChartGuide, SellStrategyGuide, BuyStrategyGuide, PositionAnalyzerGuide } from './AnalyzerGuides';

type PaperTradeSide = 'BUY' | 'SELL';

import { fetchQuotes, fetchPreviousDayOI } from '@/services/kiteApi';
import { isAbortError } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import {
  fetchOptions,
  fetchFnoSymbols,
  getSpotToken,
  getExpiries,
  buildOptionChain,
  OptionInstrument,
  OptionChainRow,
} from '@/services/optionChain';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe, tickerUpdateTokens } from '@/services/tickerSingleton';
import { isMarketLive } from '@/utils/marketStatus';
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
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => loadRecentOptionSymbols());
  const [symbolOptions, setSymbolOptions] = useState<{ value: string | number; label: string }[]>([
    { value: 'NIFTY', label: 'NIFTY 50' },
    { value: 'BANKNIFTY', label: 'BANK NIFTY' },
  ]);
  const [spotToken, setSpotToken] = useState<number>(256265);
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
  const [strategyMode, setStrategyMode] = useState<'sell' | 'buy' | 'analyzer'>('sell');

  const [orderForm, setOrderForm] = useState<{ strike: number; optionType: 'CE' | 'PE' } | null>(null);
  const [orderQty, setOrderQty] = useState(50);
  const [orderPrice, setOrderPrice] = useState(0);
  const [orderNote, setOrderNote] = useState('');
  const [orderTargetPrice, setOrderTargetPrice] = useState('');
  const [orderStopLossPrice, setOrderStopLossPrice] = useState('');
  const [orderStrategyTag, setOrderStrategyTag] = useState('Manual');
  const [orderConfidence, setOrderConfidence] = useState(70);
  const [orderMode, setOrderMode] = useState<'paper' | 'live'>(() => {
    return (localStorage.getItem('optiontrap_order_mode') as 'paper' | 'live') || 'paper';
  });
  const [oiVelocity, setOiVelocity] = useState<Map<number, OiVelocity>>(new Map());
  const [snapshots, setSnapshots] = useState<OiSnapshot[]>([]);
  const [toasts, setToasts] = useState<{ id: number; text: string; color: 'green' | 'red' }[]>([]);
  const subscribedTokensRef = useRef<number[]>([]);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastIdRef = useRef(0);
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

  const showToast = useCallback((text: string, color: 'green' | 'red') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  const resetOrderMeta = useCallback(() => {
    setOrderNote('');
    setOrderTargetPrice('');
    setOrderStopLossPrice('');
    setOrderStrategyTag('Manual');
    setOrderConfidence(70);
  }, []);

  const buildOrderMeta = useCallback((fallbackStrategyTag = 'Manual') => ({
    note: orderNote.trim(),
    targetPrice: orderTargetPrice ? Number(orderTargetPrice) : null,
    stopLossPrice: orderStopLossPrice ? Number(orderStopLossPrice) : null,
    strategyTag: orderStrategyTag.trim() || fallbackStrategyTag,
    confidence: orderConfidence,
  }), [orderConfidence, orderNote, orderStopLossPrice, orderStrategyTag, orderTargetPrice]);

  const placePaperTrade = useCallback(async ({
    instrument,
    strike,
    optionType,
    side,
    quantity,
    entryPrice,
    strategyTag = 'Manual',
    note,
    targetPrice,
    stopLossPrice,
    confidence,
  }: {
    instrument: OptionInstrument;
    strike: number;
    optionType: 'CE' | 'PE';
    side: PaperTradeSide;
    quantity: number;
    entryPrice: number;
    strategyTag?: string;
    note?: string;
    targetPrice?: number | null;
    stopLossPrice?: number | null;
    confidence?: number | null;
  }) => {
    await addPosition({
      tradingsymbol: instrument.tradingsymbol,
      instrumentToken: instrument.instrumentToken,
      strike,
      optionType,
      side,
      quantity,
      entryPrice,
      expiry: selectedExpiry,
      note,
      targetPrice,
      stopLossPrice,
      strategyTag,
      confidence,
    });
    showToast(`${side} ${strike}${optionType} @ ${entryPrice.toFixed(2)}`, 'green');
  }, [selectedExpiry, showToast]);

  const handleTicks = useCallback((ticks: Tick[]) => {
    // Update spot price eagerly (not a Map, no clone needed)
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

  // Load F&O symbols on mount
  useEffect(() => {
    fetchFnoSymbols(signal).then((symbols) => {
      const opts = symbols.map((name) => ({
        value: name,
        label: name === 'NIFTY' ? 'NIFTY 50' : name === 'BANKNIFTY' ? 'BANK NIFTY' : name,
      }));
      setSymbolOptions(opts);
    }).catch(() => { /* cancelled */ });
  }, []);

  // Load options when symbol changes
  useEffect(() => {
    loadOptions();
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
      // Update spot token for the selected symbol
      const token = getSpotToken(selectedSymbol);
      if (token) setSpotToken(token);
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

  // Find ATM strike (closest to NIFTY spot price)
  const atmStrike = useMemo(() => {
    if (chain.length === 0) return 0;
    if (spotPrice > 0) {
      // Find strike closest to spot
      let closest = chain[0].strike;
      let minDiff = Math.abs(chain[0].strike - spotPrice);
      for (const row of chain) {
        const diff = Math.abs(row.strike - spotPrice);
        if (diff < minDiff) {
          minDiff = diff;
          closest = row.strike;
        }
      }
      return closest;
    }
    // Fallback: middle of chain
    const mid = Math.floor(chain.length / 2);
    return chain[mid].strike;
  }, [chain, spotPrice]);

  // Show exactly 31 strikes centred on ATM (±15). When ATM is near an edge,
  // the window shifts rather than shrinks — count stays fixed so the table
  // height never jumps as ATM changes.
  const visibleChain = useMemo(() => {
    if (chain.length === 0) return [];
    const HALF = 15;
    const TOTAL = HALF * 2 + 1; // 31
    const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
    let start = atmIndex - HALF;
    let end = atmIndex + HALF + 1;
    if (start < 0) { end = Math.min(chain.length, end - start); start = 0; }
    if (end > chain.length) { start = Math.max(0, start - (end - chain.length)); end = chain.length; }
    return chain.slice(start, Math.min(end, start + TOTAL));
  }, [chain, atmStrike]);

  // Compute max OI across visible chain for bar width scaling
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

  // Compute average volume for volume-confirmation threshold
  const avgVolume = useMemo(() => {
    if (volumeData.size === 0) return 0;
    let total = 0;
    let count = 0;
    visibleChain.forEach((row) => {
      if (row.ce) { const v = volumeData.get(row.ce.instrumentToken); if (v) { total += v; count++; } }
      if (row.pe) { const v = volumeData.get(row.pe.instrumentToken); if (v) { total += v; count++; } }
    });
    return count > 0 ? total / count : 0;
  }, [visibleChain, volumeData]);

  // IV-based flow per option against the previous close (shown alongside OI + Price, not scored)
  const flowByToken = useMemo(
    () => computeLiveFlow(chain, oiData, prevDayOi, livePrices, closePrices, spotPrice, spotPrevClose || undefined, volumeData),
    [chain, oiData, prevDayOi, livePrices, closePrices, spotPrice, spotPrevClose, volumeData],
  );

  // Compute combined CE+PE market stance signal per strike
  const strikeSignals = useMemo(
    () => computeStrikeSignals(visibleChain, oiData, livePrices, snapshots, volumeData, avgVolume),
    [visibleChain, oiData, livePrices, snapshots, volumeData, avgVolume]
  );

  // Calculate days to expiry
  const daysToExpiry = useMemo(() => {
    if (!selectedExpiry) return undefined;
    const expiryDate = new Date(selectedExpiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiryDate.setHours(0, 0, 0, 0);
    const diff = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  }, [selectedExpiry]);

  // Calculate expected move from ATM straddle
  const expectedMove = useMemo(
    () => calculateExpectedMove(visibleChain, atmStrike, livePrices),
    [visibleChain, atmStrike, livePrices],
  );

  // Fetch previous day's closing OI for visible strikes (one-time on load)
  const prevOiFetchedRef = useRef<string>('');
  useEffect(() => {
    if (visibleChain.length === 0) return;

    // Build a key to avoid re-fetching for the same set
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
        console.log(`[OptionChain] Loaded previous day OI for ${prevOi.size} instruments`);
      }
    }).catch((err) => {
      if (!abortController.signal.aborted) {
        console.warn('[OptionChain] Failed to fetch previous day OI:', err);
      }
    });

    return () => {
      // Cancel in-flight fetch if visibleChain changes before it completes
      abortController.abort();
      prevOiFetchedRef.current = '';
    };
  }, [visibleChain]);

  // Subscribe to singleton ticker when visible chain changes (only during market hours)
  useEffect(() => {
    if (visibleChain.length === 0 || !isMarketLive()) return;

    const tokens: number[] = [spotToken];
    visibleChain.forEach((row) => {
      if (row.ce) tokens.push(row.ce.instrumentToken);
      if (row.pe) tokens.push(row.pe.instrumentToken);
    });

    // If tokens haven't changed, just update the callback ref (no reconnect needed)
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

  // OI Snapshots: load existing snapshots always, capture new ones only during market hours
  useEffect(() => {
    // Load snapshots (older days are purged by the nightly jobs)
    getTodaySnapshots(signal).then((snaps) => {
      setSnapshots(snaps);
      // Calculate initial velocity
      if (oiData.size > 0 && snaps.length > 0) {
        setOiVelocity(calculateVelocity(oiData, snaps));
      }
    }).catch(() => { /* cancelled */ });

    if (!isMarketLive()) return;

    // Set up interval to capture snapshots
    const capture = async () => {
      if (signal.aborted || !isMarketLive() || oiData.size === 0) return;
      try {
        if (await shouldTakeSnapshot(signal)) {
           await saveOiSnapshot(oiData, livePrices, closePrices, spotPrice || undefined, volumeData);
        }
        // Recalculate velocity
        const latestSnaps = await getTodaySnapshots(signal);
        setSnapshots(latestSnaps);
        if (latestSnaps.length > 0) {
          setOiVelocity(calculateVelocity(oiData, latestSnaps));
        }
      } catch (err) {
        if (!isAbortError(err)) console.error('[OI Snapshots] Capture failed:', err);
      }
    };

    // Capture immediately if needed
    capture();

    // Check every 5 minutes if a snapshot is needed
    snapshotIntervalRef.current = setInterval(capture, 5 * 60 * 1000);

    return () => {
      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
        snapshotIntervalRef.current = null;
      }
    };
  }, [oiData.size > 0]);

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

  // Recalculate velocity when OI data changes significantly
  useEffect(() => {
    if (snapshots.length > 0 && oiData.size > 0) {
      setOiVelocity(calculateVelocity(oiData, snapshots));
    }
  }, [oiData, snapshots]);

  // Market closed: fetch quotes when chain is ready.
  // Two-phase approach: first fetch NIFTY spot to determine correct ATM,
  // then fetch all option strikes around the real ATM.
  const quoteFetchedRef = useRef<string>('');
  useEffect(() => {
    if (chain.length === 0 || isMarketLive()) return;

    // Build a key from the visible strikes to detect when ATM shifts
    const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
    const start = Math.max(0, atmIndex - 15);
    const end = Math.min(chain.length, atmIndex + 16);
    const strikes = chain.slice(start, end);
    const fetchKey = `${selectedExpiry}_${strikes[0]?.strike}_${strikes[strikes.length - 1]?.strike}`;

    // Skip if we already fetched for this exact range
    if (quoteFetchedRef.current === fetchKey) return;
    quoteFetchedRef.current = fetchKey;

    // Build spot instrument key for Kite quotes API
    const SPOT_QUOTE_KEYS: Record<string, string> = {
      NIFTY: 'NSE:NIFTY 50',
      BANKNIFTY: 'NSE:NIFTY BANK',
    };
    const spotQuoteKey = SPOT_QUOTE_KEYS[selectedSymbol] || `NSE:${selectedSymbol}`;

    const instruments: string[] = [spotQuoteKey];
    strikes.forEach((row) => {
      if (row.ce) instruments.push(`NFO:${row.ce.tradingsymbol}`);
      if (row.pe) instruments.push(`NFO:${row.pe.tradingsymbol}`);
    });

    console.log(`[Trades] Fetching quotes for ${instruments.length} instruments (strikes ${strikes[0]?.strike}–${strikes[strikes.length - 1]?.strike})`);

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

      const spotQuote = quotes.get(spotQuoteKey);
      if (spotQuote) {
        setSpotPrice(spotQuote.last_price);
        if (spotQuote.ohlc.close > 0) setSpotPrevClose(spotQuote.ohlc.close);
      }

      // Log any missing instruments
      const missing: string[] = [];
      strikes.forEach((row) => {
        if (row.ce && !quotes.has(`NFO:${row.ce.tradingsymbol}`)) missing.push(`NFO:${row.ce.tradingsymbol}`);
        if (row.pe && !quotes.has(`NFO:${row.pe.tradingsymbol}`)) missing.push(`NFO:${row.pe.tradingsymbol}`);
      });
      if (missing.length > 0) console.warn(`[Trades] Missing quotes for: ${missing.join(', ')}`);

      console.log(`[Trades] Got quotes for ${priceMap.size} options, spot: ${spotQuote?.last_price}`);
    }).catch((err) => {
      if (isAbortError(err)) return;
      console.error('[Trades] Failed to fetch quotes:', err);
      // Reset so it can retry
      quoteFetchedRef.current = '';
      // Fallback to latest server OI snapshot
      getTodaySnapshots(signal).then((snaps) => {
        if (snaps.length > 0) {
          const latest = snaps[snaps.length - 1];
          if (latest.prices) setLivePrices(new Map(Object.entries(latest.prices).map(([k, v]) => [Number(k), v])));
          if (latest.data) setOiData(new Map(Object.entries(latest.data).map(([k, v]) => [Number(k), v])));
          if (latest.close) setClosePrices(new Map(Object.entries(latest.close).map(([k, v]) => [Number(k), v])));
          if (latest.spot) setSpotPrice(latest.spot);
        }
      }).catch(() => { /* cancelled */ });
    });
  }, [chain, atmStrike, selectedExpiry, selectedSymbol]);

  // Helper to get live price or fallback to CSV price
  const getPrice = (instrument: OptionInstrument | null): number | null => {
    if (!instrument) return null;
    const live = livePrices.get(instrument.instrumentToken);
    if (live !== undefined && live > 0) return live;
    return instrument.lastPrice > 0 ? instrument.lastPrice : null;
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

  // Helper to get OI % change from previous day's closing OI
  const getOiChange = (instrument: OptionInstrument | null): { pct: number; color: string } | null => {
    if (!instrument) return null;
    const currentOi = oiData.get(instrument.instrumentToken);
    const prevOi = prevDayOi.get(instrument.instrumentToken);
    if (currentOi === undefined || prevOi === undefined || prevOi === 0) return null;
    const pct = ((currentOi - prevOi) / prevOi) * 100;
    const color = pct > 0 ? 'positive' : pct < 0 ? 'negative' : '';
    return { pct, color };
  };

  // One CE or PE section of the OI chart tooltip.
  const renderTooltipSide = (
    side: 'CE' | 'PE',
    option: OptionChainRow['ce'],
    oi: number,
    prevOi: number,
    velocity: OiVelocity | undefined,
  ) => {
    const flow = option ? flowByToken.get(option.instrumentToken) : undefined;
    const pattern = option && velocity ? analyzeVelocityPattern(option.instrumentToken, velocity.currentOi, snapshots) : null;
    const chgPct = prevOi > 0 ? ((oi - prevOi) / prevOi) * 100 : null;
    const sideClass = side === 'CE' ? 'ce' : 'pe';
    return (
      <div className={`oc-tip__side oc-tip__side--${sideClass}`}>
        <div className="oc-tip__side-title">{side === 'CE' ? 'Calls' : 'Puts'}</div>
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
        {flow && flow.label !== '-' && (
          <div className="oc-tip__row oc-tip__row--flow" title={describeFlow(flow).join('\n')}>
            <span>IV flow</span>
            <span className="oc-tip__flow">
              <span style={{ color: flowColor(flow.label) }}>{flow.label}</span>
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
                stroke={pattern.direction === 'up' ? '#4ade80' : pattern.direction === 'down' ? '#f87171' : '#94a3b8'}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span className={`oc-chart__pattern-label oc-chart__pattern-label--${pattern.direction}`}>{pattern.label}</span>
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
      {toasts.length > 0 && (
        <div className="oc-toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`oc-toast oc-toast--${t.color}`}>{t.text}</div>
          ))}
        </div>
      )}
      {/* Global Expiry Selector */}
      {expiries.length > 0 && (
        <div className="oc-expiry-panel">
          <div className="oc-expiry-bar">
            <AppSelect
              value={selectedSymbol}
              options={symbolOptions}
              onChange={(v) => selectSymbol(String(v))}
              searchable
            />
            <span className="oc-expiry-bar__label">Expiry</span>
            <AppSelect
              value={selectedExpiry}
              options={expiries.map((exp) => ({
                value: exp,
                label: new Date(exp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
              }))}
              onChange={(v) => setSelectedExpiry(String(v))}
              className="oc-expiry-select"
            />
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

      {/* Option Chain Card */}
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
                      <td className={`oc-cell-ltp oc-cell-ltp--clickable oc-cell-ltp--hover-btns ${ceItm ? 'oc-cell--itm-ce' : ''}`} onClick={() => { setOrderForm(isOrderOpen && orderForm?.optionType === 'CE' ? null : { strike: row.strike, optionType: 'CE' }); if (cePrice) setOrderPrice(cePrice); if (row.ce) setOrderQty(row.ce.lotSize); if (!(isOrderOpen && orderForm?.optionType === 'CE')) resetOrderMeta(); }}>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--buy" onClick={async (e) => { e.stopPropagation(); if (!row.ce || cePrice === null || orderMode !== 'paper') return; try { await placePaperTrade({ instrument: row.ce, strike: row.strike, optionType: 'CE', side: 'BUY', quantity: row.ce.lotSize, entryPrice: cePrice, strategyTag: 'Quick Trade' }); } catch { showToast('Failed to add position', 'red'); } }}>B</button>
                        <span className="oc-ltp-price">
                          {cePrice !== null ? cePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                          {ceChg && <span className={`oc-cell-chg ${ceChg.color}`}>{ceChg.pct >= 0 ? '+' : ''}{ceChg.pct.toFixed(2)}%</span>}
                        </span>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--sell" onClick={async (e) => { e.stopPropagation(); if (!row.ce || cePrice === null || orderMode !== 'paper') return; try { await placePaperTrade({ instrument: row.ce, strike: row.strike, optionType: 'CE', side: 'SELL', quantity: row.ce.lotSize, entryPrice: cePrice, strategyTag: 'Quick Trade' }); } catch { showToast('Failed to add position', 'red'); } }}>S</button>
                      </td>
                      <td className="oc-cell-strike">
                        <div className="oc-strike-bars">
                          <div className="oc-oi-bar oc-oi-bar--ce" style={{ width: `${maxOi > 0 && ceOi ? (ceOi / maxOi) * 50 : 0}%` }} />
                          <div className="oc-oi-bar oc-oi-bar--pe" style={{ width: `${maxOi > 0 && peOi ? (peOi / maxOi) * 50 : 0}%` }} />
                        </div>
                        {row.strike}
                      </td>
                      <td className={`oc-cell-ltp oc-cell-ltp--clickable oc-cell-ltp--hover-btns ${peItm ? 'oc-cell--itm-pe' : ''}`} onClick={() => { setOrderForm(isOrderOpen && orderForm?.optionType === 'PE' ? null : { strike: row.strike, optionType: 'PE' }); if (pePrice) setOrderPrice(pePrice); if (row.pe) setOrderQty(row.pe.lotSize); if (!(isOrderOpen && orderForm?.optionType === 'PE')) resetOrderMeta(); }}>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--buy" onClick={async (e) => { e.stopPropagation(); if (!row.pe || pePrice === null || orderMode !== 'paper') return; try { await placePaperTrade({ instrument: row.pe, strike: row.strike, optionType: 'PE', side: 'BUY', quantity: row.pe.lotSize, entryPrice: pePrice, strategyTag: 'Quick Trade' }); } catch { showToast('Failed to add position', 'red'); } }}>B</button>
                        <span className="oc-ltp-price">
                          {pePrice !== null ? pePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                          {peChg && <span className={`oc-cell-chg ${peChg.color}`}>{peChg.pct >= 0 ? '+' : ''}{peChg.pct.toFixed(2)}%</span>}
                        </span>
                        <button className="oc-ltp-action-btn oc-ltp-action-btn--sell" onClick={async (e) => { e.stopPropagation(); if (!row.pe || pePrice === null || orderMode !== 'paper') return; try { await placePaperTrade({ instrument: row.pe, strike: row.strike, optionType: 'PE', side: 'SELL', quantity: row.pe.lotSize, entryPrice: pePrice, strategyTag: 'Quick Trade' }); } catch { showToast('Failed to add position', 'red'); } }}>S</button>
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

        {!loading && !error && options.length === 0 && (
          <p className="card__description" style={{ marginTop: 16 }}>
            No option data available.
          </p>
        )}
      </div>

      {/* Order Modal */}
      {orderForm && (() => {
        const row = visibleChain.find((r) => r.strike === orderForm.strike);
        if (!row) return null;
        const instrument = orderForm.optionType === 'CE' ? row.ce : row.pe;
        if (!instrument) return null;
        return (
          <div className="oc-order-modal-overlay" onClick={() => setOrderForm(null)} onKeyDown={(e) => { if (e.key === 'Escape') setOrderForm(null); }} tabIndex={-1} ref={(el) => el?.focus()}>
            <div className="oc-order-modal" onClick={(e) => e.stopPropagation()}>
              <div className="oc-order-modal__header">
                <span className="oc-order-modal__title">{orderForm.strike} {orderForm.optionType}</span>
                <button className="oc-order-modal__close" onClick={() => setOrderForm(null)}>✕</button>
              </div>
              <div className="oc-order-modal__body">
                <div className="oc-order-modal__mode">
                  <button className={`oc-order-modal__mode-btn ${orderMode === 'paper' ? 'active' : ''}`} onClick={() => { setOrderMode('paper'); localStorage.setItem('optiontrap_order_mode', 'paper'); }}>Paper</button>
                  <button className={`oc-order-modal__mode-btn ${orderMode === 'live' ? 'active' : ''}`} onClick={() => { setOrderMode('live'); localStorage.setItem('optiontrap_order_mode', 'live'); }}>Live</button>
                </div>
                <div className="oc-order-modal__fields">
                  <div className="oc-order-modal__field">
                    <span>Quantity (Lot: {instrument.lotSize})</span>
                    <div className="oc-order-modal__number">
                      <input type="number" value={orderQty} onChange={(e) => setOrderQty(Number(e.target.value))} min={instrument.lotSize} step={instrument.lotSize} />
                      <div className="oc-order-modal__number-btns">
                        <button type="button" className="oc-order-modal__number-btn" onClick={() => setOrderQty(orderQty + instrument.lotSize)}>▲</button>
                        <button type="button" className="oc-order-modal__number-btn" onClick={() => setOrderQty(Math.max(instrument.lotSize, orderQty - instrument.lotSize))}>▼</button>
                      </div>
                    </div>
                  </div>
                  <div className="oc-order-modal__field">
                    <span>Price</span>
                    <div className="oc-order-modal__number">
                      <input type="number" value={orderPrice} onChange={(e) => setOrderPrice(Number(e.target.value))} min={0} step={0.05} />
                      <div className="oc-order-modal__number-btns">
                        <button type="button" className="oc-order-modal__number-btn" onClick={() => setOrderPrice(+(orderPrice + 0.5).toFixed(2))}>▲</button>
                        <button type="button" className="oc-order-modal__number-btn" onClick={() => setOrderPrice(Math.max(0, +(orderPrice - 0.5).toFixed(2)))}>▼</button>
                      </div>
                    </div>
                  </div>
                </div>
                {orderMode === 'paper' && (
                  <div className="oc-order-modal__meta">
                    <div className="oc-order-modal__fields">
                      <label className="oc-order-modal__field">
                        <span>Target</span>
                        <input type="number" value={orderTargetPrice} onChange={(e) => setOrderTargetPrice(e.target.value)} min={0} step={0.05} placeholder="Optional" />
                      </label>
                      <label className="oc-order-modal__field">
                        <span>Stop-loss</span>
                        <input type="number" value={orderStopLossPrice} onChange={(e) => setOrderStopLossPrice(e.target.value)} min={0} step={0.05} placeholder="Optional" />
                      </label>
                    </div>
                    <div className="oc-order-modal__fields">
                      <label className="oc-order-modal__field">
                        <span>Strategy</span>
                        <input type="text" value={orderStrategyTag} onChange={(e) => setOrderStrategyTag(e.target.value)} maxLength={32} placeholder="Manual" />
                      </label>
                      <label className="oc-order-modal__field">
                        <span>Confidence: {orderConfidence}%</span>
                        <input type="range" value={orderConfidence} onChange={(e) => setOrderConfidence(Number(e.target.value))} min={0} max={100} step={5} />
                      </label>
                    </div>
                    <label className="oc-order-modal__field">
                      <span>Trade Note</span>
                      <textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)} rows={3} maxLength={240} placeholder="Why are you taking this trade?" />
                    </label>
                  </div>
                )}
              </div>
              <div className="oc-order-modal__footer">
                {orderMode === 'live' && (
                  <p className="oc-order-modal__live-notice">Live trading coming soon. Use Paper mode to track positions.</p>
                )}
                {orderMode === 'paper' && (
                  <>
                    <button className="oc-order-panel__btn oc-order-panel__btn--buy" onClick={async () => {
                      try { await placePaperTrade({ instrument, strike: orderForm.strike, optionType: orderForm.optionType, side: 'BUY', quantity: orderQty, entryPrice: orderPrice, ...buildOrderMeta() }); resetOrderMeta(); } catch { showToast('Failed to add position', 'red'); }
                      setOrderForm(null);
                    }}>Buy</button>
                    <button className="oc-order-panel__btn oc-order-panel__btn--sell" onClick={async () => {
                      try { await placePaperTrade({ instrument, strike: orderForm.strike, optionType: orderForm.optionType, side: 'SELL', quantity: orderQty, entryPrice: orderPrice, ...buildOrderMeta() }); resetOrderMeta(); } catch { showToast('Failed to add position', 'red'); }
                      setOrderForm(null);
                    }}>Sell</button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* OI Bar Chart Card */}
      {!loading && !error && visibleChain.length > 0 && (
        <div className={`card oc-chart-card ${selectedChartStrike !== null ? 'oc-chart-card--tooltip-open' : ''}`} style={{ marginTop: 24 }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <h3 className="card__title" style={{ marginBottom: 0 }}>OI Chart <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)' }}>(daily changes)</span></h3>
              <button className="trap-info-btn" onClick={() => setShowOiChartInfo(!showOiChartInfo)} title="How to read this chart">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
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
                {/* Expected Range Overlay */}
                {expectedMove > 0 && spotPrice > 0 && (() => {
                  const totalStrikes = visibleChain.length;
                  if (totalStrikes < 2) return null;
                  // Find first and last strike index within expected range
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
                      // Find the tallest bar % in the chart for consistent tooltip position
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
                        {renderTooltipSide('CE', row.ce, ceOi, cePrevOi, ceVelocity)}
                        {renderTooltipSide('PE', row.pe, peOi, pePrevOi, peVelocity)}
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
                                  <span className={`oc-chart__tooltip-confidence oc-chart__tooltip-confidence--${signal.confidence}`}>
                                    {signal.confidence === 'high' ? 'Confirmed' : signal.confidence === 'medium' ? 'Normal' : 'Low Vol'}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : null;
                        })()}
                        {orderMode === 'paper' && (
                          <div className="oc-chart__tooltip-actions">
                            <button
                              className="oc-chart__tooltip-sell-btn oc-chart__tooltip-sell-btn--pe"
                              disabled={!row.pe || peLtp === null}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!row.pe || peLtp === null) return;
                                try {
                                  await placePaperTrade({ instrument: row.pe, strike: row.strike, optionType: 'PE', side: 'SELL', quantity: row.pe.lotSize, entryPrice: peLtp, strategyTag: 'OI Chart' });
                                  setSelectedChartStrike(null);
                                } catch { showToast('Failed to add position', 'red'); }
                              }}
                            >Sell PE {peLtp !== null ? `@ ${peLtp.toFixed(0)}` : ''}</button>
                            <button
                              className="oc-chart__tooltip-sell-btn oc-chart__tooltip-sell-btn--ce"
                              disabled={!row.ce || ceLtp === null}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!row.ce || ceLtp === null) return;
                                try {
                                  await placePaperTrade({ instrument: row.ce, strike: row.strike, optionType: 'CE', side: 'SELL', quantity: row.ce.lotSize, entryPrice: ceLtp, strategyTag: 'OI Chart' });
                                  setSelectedChartStrike(null);
                                } catch { showToast('Failed to add position', 'red'); }
                              }}
                            >Sell CE {ceLtp !== null ? `@ ${ceLtp.toFixed(0)}` : ''}</button>
                          </div>
                        )}
                      </div>
                      );
                    })()}
                    {/* Velocity indicators */}
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

      {/* Strategy (Sell / Buy / Analyzer) */}
      {!loading && !error && visibleChain.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <h3 className="card__title" style={{ marginBottom: 0 }}>Strategy</h3>
              <button className="trap-info-btn" onClick={() => setShowSellStrategyInfo(!showSellStrategyInfo)} title="How this works">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>
          {showSellStrategyInfo && (
            strategyMode === 'sell' ? <SellStrategyGuide />
              : strategyMode === 'buy' ? <BuyStrategyGuide />
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
