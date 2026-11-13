import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchQuotes, fetchPreviousDayOI } from '@/services/kiteApi';
import { isAbortError } from '@/services/apiClient';
import type { OptionChainRow } from '@/services/optionChain';
import type { Underlying } from '@/services/underlyings';
import type { Tick } from '@/services/kiteTicker';
import { tickerSubscribe, tickerUpdateTokens } from '@/services/tickerSingleton';
import { getLatestSnapshotTimestamp, getTodaySnapshots, watchSnapshotSymbol, withSpot, type OiSnapshot } from '@/services/oiSnapshots';
import { isMarketLive } from '@/utils/marketStatus';
import { atmStrikeOf, strikeWindow } from '../../../shared/optionAnalysis/chain.js';
import { chainTokens, pricesFromQuotes, pricesFromSnapshot, quoteKeys, quoteStrikes, withTicks } from './chainMetrics';

const RECENT_OPTION_SYMBOLS_KEY = 'optiontrap_option_analyzer_recent_symbols';
const MAX_RECENT_OPTION_SYMBOLS = 5;
const SNAPSHOT_POLL_MS = 60 * 1000;

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

/** The symbol shown (the last one opened; none until the user picks one) and the recently opened ones. */
export function useSymbolChoice(symbolOptions: { value: string; label: string }[]) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => loadRecentOptionSymbols()[0] ?? '');
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => loadRecentOptionSymbols());

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
    return recentSymbols.filter((value) => value !== selectedSymbol).map((value) => ({ value, label: labels.get(value) || value }));
  }, [recentSymbols, selectedSymbol, symbolOptions]);

  return { selectedSymbol, selectSymbol, recentSymbolOptions };
}

/**
 * The chain around its ATM (the strike nearest the spot, shared with the trade engine's Option Analyzer setups),
 * with the prices, OI, volumes and previous closes of its options and the spot: from live ticks while the market is
 * open (re-subscribing only when the token set changes), else from quotes around the ATM, falling back to the latest
 * server snapshot when the quotes fail. The spot's previous close is forgotten when `resetKey` changes (a new symbol).
 */
export function useLiveChain(input: {
  chain: OptionChainRow[];
  expiry: string;
  underlying: Underlying | null;
  resetKey: unknown;
  signal: AbortSignal;
}) {
  const { chain, expiry, underlying, resetKey, signal } = input;
  const spotToken = underlying?.instrumentToken ?? null;
  const spotQuoteKey = underlying?.tradingsymbol ? `${underlying.exchange}:${underlying.tradingsymbol}` : null;
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [closePrices, setClosePrices] = useState<Map<number, number>>(new Map());
  const [oiData, setOiData] = useState<Map<number, number>>(new Map());
  const [volumeData, setVolumeData] = useState<Map<number, number>>(new Map());
  const [spotPrice, setSpotPrice] = useState(0);
  const [spotPrevClose, setSpotPrevClose] = useState(0);
  const subscribedTokensRef = useRef<number[]>([]);
  const quoteFetchedRef = useRef('');
  const atmStrike = useMemo(() => atmStrikeOf(chain, spotPrice), [chain, spotPrice]);
  // Exactly 31 strikes centred on ATM (±15). Near an edge the window shifts rather than shrinks, so the table
  // height never jumps as ATM changes.
  const visibleChain = useMemo(() => strikeWindow(chain, atmStrike), [chain, atmStrike]);

  useEffect(() => { setSpotPrevClose(0); }, [resetKey]);

  const handleTicks = useCallback((ticks: Tick[]) => {
    const spotTick = ticks.find((t) => t.instrumentToken === spotToken);
    if (spotTick) {
      setSpotPrice(spotTick.lastPrice);
      if (spotTick.closePrice && spotTick.closePrice > 0) setSpotPrevClose(spotTick.closePrice);
    }
    const optionTicks = ticks.filter((t) => t.instrumentToken !== spotToken);
    setLivePrices((prev) => withTicks(prev, optionTicks, (t) => t.lastPrice));
    setClosePrices((prev) => withTicks(prev, optionTicks, (t) => (t.closePrice !== undefined && t.closePrice > 0 ? t.closePrice : undefined)));
    setOiData((prev) => withTicks(prev, optionTicks, (t) => t.oi));
    setVolumeData((prev) => withTicks(prev, optionTicks, (t) => t.volume));
  }, [spotToken]);

  // Subscribe only during market hours.
  useEffect(() => {
    if (visibleChain.length === 0 || !isMarketLive()) return;
    const tokens = [...(spotToken !== null ? [spotToken] : []), ...chainTokens(visibleChain)];
    const prevTokens = subscribedTokensRef.current;
    if (tokens.length !== prevTokens.length || tokens.some((t, i) => t !== prevTokens[i])) {
      tickerUpdateTokens('option-chain', tokens);
    }
    subscribedTokensRef.current = tokens;
    return tickerSubscribe('option-chain', tokens, handleTicks);
    // spotToken is read through handleTicks, which changes with it.
  }, [visibleChain, handleTicks]);

  // Market closed: quote the spot and the strikes around the ATM once the chain is ready.
  useEffect(() => {
    if (chain.length === 0 || isMarketLive()) return;
    const strikes = quoteStrikes(chain, atmStrike);
    // The spot key is part of it: the symbol list (and so the spot) may arrive after the chain.
    const fetchKey = `${spotQuoteKey}_${expiry}_${strikes[0]?.strike}_${strikes[strikes.length - 1]?.strike}`;
    if (quoteFetchedRef.current === fetchKey) return;
    quoteFetchedRef.current = fetchKey;

    fetchQuotes(quoteKeys(strikes, spotQuoteKey), signal).then((quotes) => {
      const { prices, oi, close, missing } = pricesFromQuotes(strikes, quotes);
      setLivePrices(prices);
      setOiData(oi);
      setClosePrices(close);
      const spotQuote = spotQuoteKey ? quotes.get(spotQuoteKey) : undefined;
      if (spotQuote) {
        setSpotPrice(spotQuote.last_price);
        if (spotQuote.ohlc.close > 0) setSpotPrevClose(spotQuote.ohlc.close);
      }
      if (missing.length > 0) console.warn(`[Trades] Missing quotes for: ${missing.join(', ')}`);
    }).catch((err) => {
      if (isAbortError(err)) return;
      console.error('[Trades] Failed to fetch quotes:', err);
      quoteFetchedRef.current = ''; // so it can retry
      getTodaySnapshots(signal).then((snaps) => {
        if (snaps.length === 0) return;
        const [latest] = withSpot(snaps.slice(-1), spotToken);
        const fallback = pricesFromSnapshot(latest);
        if (fallback.prices) setLivePrices(fallback.prices);
        if (fallback.oi) setOiData(fallback.oi);
        if (fallback.close) setClosePrices(fallback.close);
        if (latest.spot) setSpotPrice(latest.spot);
      }).catch(() => { /* cancelled */ });
    });
  }, [chain, atmStrike, expiry, spotQuoteKey]);

  return { atmStrike, visibleChain, livePrices, closePrices, oiData, volumeData, spotPrice, spotPrevClose };
}

/** The chain's previous-day OI, fetched again only when its tokens change; shown as batches arrive. */
export function usePrevDayOi(visibleChain: OptionChainRow[]): Map<number, number> {
  const [prevDayOi, setPrevDayOi] = useState<Map<number, number>>(new Map());
  const fetchedKeyRef = useRef('');

  useEffect(() => {
    if (visibleChain.length === 0) return;
    const tokens = chainTokens(visibleChain);
    const fetchKey = tokens.join(',');
    if (fetchedKeyRef.current === fetchKey) return;
    fetchedKeyRef.current = fetchKey;

    const abortController = new AbortController();
    fetchPreviousDayOI(tokens, (partial) => { setPrevDayOi(partial); }, abortController.signal)
      .then((prevOi) => {
        if (!abortController.signal.aborted && prevOi.size > 0) setPrevDayOi(prevOi);
      })
      .catch((err) => {
        if (!abortController.signal.aborted) console.warn('[OptionChain] Failed to fetch previous day OI:', err);
      });
    return () => {
      abortController.abort();
      fetchedKeyRef.current = '';
    };
  }, [visibleChain]);

  return prevDayOi;
}

/**
 * Today's server OI snapshots (the always-snapshot symbols, plus others once opened here): registers the symbol,
 * loads them, and during market hours picks up each new one (one per 10 minutes).
 */
export function useOiSnapshots(symbol: string, spotToken: number | null, signal: AbortSignal): OiSnapshot[] {
  const [allSnapshots, setSnapshots] = useState<OiSnapshot[]>([]);
  const latestTimestampRef = useRef<number | null>(null);

  const loadSnapshots = useCallback(async () => {
    const snaps = await getTodaySnapshots(signal);
    latestTimestampRef.current = snaps.length > 0 ? snaps[snaps.length - 1].timestamp : null;
    setSnapshots(snaps);
  }, [signal]);

  useEffect(() => {
    if (!symbol) return;
    watchSnapshotSymbol(symbol, signal)
      .then(loadSnapshots)
      .catch((err) => { if (!isAbortError(err)) console.error('[OI Snapshots] Load failed:', err); });
  }, [symbol, loadSnapshots]);

  useEffect(() => {
    const poll = async () => {
      if (!isMarketLive()) return;
      try {
        const latest = await getLatestSnapshotTimestamp(signal);
        if (latest !== null && latest !== latestTimestampRef.current) await loadSnapshots();
      } catch (err) {
        if (!isAbortError(err)) console.warn('[OI Snapshots] Poll failed:', err);
      }
    };
    const id = setInterval(poll, SNAPSHOT_POLL_MS);
    return () => clearInterval(id);
  }, [loadSnapshots]);

  return useMemo(() => withSpot(allSnapshots, spotToken), [allSnapshots, spotToken]);
}
