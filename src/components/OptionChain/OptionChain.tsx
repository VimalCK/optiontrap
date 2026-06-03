import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TradesIcon } from '@/components/icons/Icons';
import { getSession, clearSession } from '@/services/kiteAuth';
import { notifySessionChange } from '@/hooks/useKiteSession';
import TrapAnalyzer from '@/components/TrapAnalyzer/TrapAnalyzer';
import BestStrikes from '@/components/TrapAnalyzer/BestStrikes';
import { calculateExpectedMove } from '@/services/edgeScore';
import { saveOiSnapshot, getTodaySnapshots, cleanOldSnapshots, calculateVelocity, shouldTakeSnapshot, OiSnapshot, OiVelocity } from '@/services/oiSnapshots';

const TrapInfoPanel: React.FC<{ onToggle: (show: boolean) => void; show: boolean }> = ({ onToggle, show }) => {
  return (
    <button className="trap-info-btn" onClick={() => onToggle(!show)} title="How does this work?">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
      </svg>
    </button>
  );
};

const TrapInfoDetail: React.FC = () => (
  <div className="trap-info-detail">
    <h4>How Position Analyzer Works</h4>
    <p>The analyzer combines multiple data points to determine if your option position is at risk of getting trapped by smart money.</p>

    <h5>1. Max Pain</h5>
    <p>The strike price where maximum options expire worthless. Option sellers (institutions) benefit most at this price. NIFTY tends to gravitate toward max pain near expiry. If your position profits only far from max pain, you face "gravitational pull" risk.</p>

    <h5>2. OI + Price Signal</h5>
    <p>Combines Open Interest change with price movement to classify market activity:</p>
    <ul>
      <li><strong>Long Buildup</strong> — OI ↑ + Price ↑ — New buyers entering aggressively (bullish)</li>
      <li><strong>Short Buildup</strong> — OI ↑ + Price ↓ — New sellers entering aggressively (bearish)</li>
      <li><strong>Long Unwinding</strong> — OI ↓ + Price ↓ — Buyers exiting, giving up (bearish)</li>
      <li><strong>Short Covering</strong> — OI ↓ + Price ↑ — Sellers exiting, bears giving up (bullish)</li>
    </ul>

    <h5>3. PCR (Put-Call Ratio)</h5>
    <p>Total PE OI divided by Total CE OI across all strikes.</p>
    <ul>
      <li><strong>PCR &gt; 1.5</strong> — Heavy put selling, market unlikely to fall much (bullish bias)</li>
      <li><strong>PCR &lt; 0.7</strong> — Heavy call selling, market unlikely to rise much (bearish bias)</li>
      <li><strong>PCR ~1.0</strong> — Balanced, no strong directional bias</li>
    </ul>

    <h5>4. OI Walls (Support & Resistance)</h5>
    <p>Strikes with significantly higher OI than average indicate levels where option sellers have large positions. They will defend these levels:</p>
    <ul>
      <li><strong>High CE OI at a strike</strong> = Resistance — call sellers will defend this level from being breached upward</li>
      <li><strong>High PE OI at a strike</strong> = Support — put sellers will defend this level from being breached downward</li>
    </ul>

    <h5>Verdict Scoring</h5>
    <p>Each factor contributes to a trap score (0–9 scale). The final verdict is:</p>
    <ul>
      <li><strong>Safe (0–1)</strong> — No significant signals against your position</li>
      <li><strong>Caution (2–3)</strong> — Some factors suggest risk, but not conclusive</li>
      <li><strong>Likely Trapped (4+)</strong> — Multiple strong signals indicate your position may face headwinds</li>
    </ul>

    <h5>Score Breakdown (max 9)</h5>
    <ul>
      <li><strong>Max Pain</strong> — Strike on wrong side of max pain: +2</li>
      <li><strong>OI Wall</strong> — Heavy OI wall blocking your direction: +2</li>
      <li><strong>PCR</strong> — Put-Call Ratio skewed against you: +1</li>
      <li><strong>OI Signal</strong> — Bearish/bullish activity against your position: +2</li>
      <li><strong>Time Pressure</strong> — Within 3 days of expiry: +1, Expiry day: +2</li>
    </ul>
  </div>
);

import { fetchQuotes, fetchPreviousDayOI } from '@/services/kiteApi';
import { cacheGet, cacheSet } from '@/services/cacheDb';
import {
  fetchNiftyOptions,
  getExpiries,
  buildOptionChain,
  OptionInstrument,
  OptionChainRow,
} from '@/services/optionChain';
import { KiteTicker, Tick } from '@/services/kiteTicker';
import { isMarketLive } from '@/utils/marketStatus';
import '@/styles/optionchain.css';

const NIFTY_INDEX_TOKEN = 256265; // NSE:NIFTY 50

const OptionChain: React.FC = () => {
  const navigate = useNavigate();
  const [options, setOptions] = useState<OptionInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [closePrices, setClosePrices] = useState<Map<number, number>>(new Map());
  const [oiData, setOiData] = useState<Map<number, number>>(new Map());
  const [volumeData, setVolumeData] = useState<Map<number, number>>(new Map());
  const [prevDayOi, setPrevDayOi] = useState<Map<number, number>>(new Map());
  const [niftySpot, setNiftySpot] = useState<number>(0);
  const [selectedChartStrike, setSelectedChartStrike] = useState<number | null>(null);
  const [showTrapInfo, setShowTrapInfo] = useState(false);
  const [showOiChartInfo, setShowOiChartInfo] = useState(false);
  const [showBestStrikesInfo, setShowBestStrikesInfo] = useState(false);
  const [oiVelocity, setOiVelocity] = useState<Map<number, OiVelocity>>(new Map());
  const [snapshots, setSnapshots] = useState<OiSnapshot[]>([]);
  const tickerRef = useRef<KiteTicker | null>(null);
  const subscribedTokensRef = useRef<number[]>([]);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [session, setSession] = useState(getSession);

  const handleTicks = useCallback((ticks: Tick[]) => {
    setLivePrices((prev) => {
      const next = new Map(prev);
      ticks.forEach((t) => {
        if (t.instrumentToken === NIFTY_INDEX_TOKEN) {
          setNiftySpot(t.lastPrice);
        } else {
          next.set(t.instrumentToken, t.lastPrice);
        }
      });
      return next;
    });
    setClosePrices((prev) => {
      const next = new Map(prev);
      ticks.forEach((t) => {
        if (t.closePrice !== undefined && t.closePrice > 0 && t.instrumentToken !== NIFTY_INDEX_TOKEN) {
          next.set(t.instrumentToken, t.closePrice);
        }
      });
      return next;
    });
    setOiData((prev) => {
      const next = new Map(prev);
      ticks.forEach((t) => {
        if (t.oi !== undefined && t.instrumentToken !== NIFTY_INDEX_TOKEN) {
          next.set(t.instrumentToken, t.oi);
        }
      });
      return next;
    });
    setVolumeData((prev) => {
      const next = new Map(prev);
      ticks.forEach((t) => {
        if (t.volume !== undefined && t.instrumentToken !== NIFTY_INDEX_TOKEN) {
          next.set(t.instrumentToken, t.volume);
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (session) {
      loadOptions();
    }
    return () => {
      if (tickerRef.current) {
        tickerRef.current.disconnect();
        tickerRef.current = null;
      }
    };
  }, []);

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNiftyOptions();
      setOptions(data);
      const expiries = getExpiries(data);
      if (expiries.length > 0) {
        setSelectedExpiry(expiries[0]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load option chain';
      if (msg.toLowerCase().includes('session expired') || msg.toLowerCase().includes('login again')) {
        clearSession();
        notifySessionChange();
        setSession(null);
      } else {
        setError(msg);
      }
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
    if (niftySpot > 0) {
      // Find strike closest to spot
      let closest = chain[0].strike;
      let minDiff = Math.abs(chain[0].strike - niftySpot);
      for (const row of chain) {
        const diff = Math.abs(row.strike - niftySpot);
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
  }, [chain, niftySpot]);

  // Show strikes around ATM (±15 strikes)
  const visibleChain = useMemo(() => {
    if (chain.length === 0) return [];
    const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
    const start = Math.max(0, atmIndex - 15);
    const end = Math.min(chain.length, atmIndex + 16);
    return chain.slice(start, end);
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
    if (!session || visibleChain.length === 0) return;

    // Build a key to avoid re-fetching for the same set
    const tokens: number[] = [];
    visibleChain.forEach((row) => {
      if (row.ce) tokens.push(row.ce.instrumentToken);
      if (row.pe) tokens.push(row.pe.instrumentToken);
    });
    const fetchKey = tokens.join(',');
    if (prevOiFetchedRef.current === fetchKey) return;
    prevOiFetchedRef.current = fetchKey;

    fetchPreviousDayOI(tokens).then((prevOi) => {
      if (prevOi.size > 0) {
        setPrevDayOi(prevOi);
        console.log(`[Trades] Loaded previous day OI for ${prevOi.size} instruments`);
      }
    }).catch((err) => {
      console.warn('[Trades] Failed to fetch previous day OI:', err);
    });
  }, [visibleChain, session]);

  // Connect/reconnect WebSocket when visible chain changes (only during market hours)
  useEffect(() => {
    if (!session || visibleChain.length === 0 || !isMarketLive()) return;

    const tokens: number[] = [NIFTY_INDEX_TOKEN];
    visibleChain.forEach((row) => {
      if (row.ce) tokens.push(row.ce.instrumentToken);
      if (row.pe) tokens.push(row.pe.instrumentToken);
    });

    // If tokens haven't changed, skip
    const prevTokens = subscribedTokensRef.current;
    const tokensChanged = tokens.length !== prevTokens.length ||
      tokens.some((t, i) => t !== prevTokens[i]);

    if (!tokensChanged && tickerRef.current) return;

    // Disconnect existing connection
    if (tickerRef.current) {
      tickerRef.current.disconnect();
      tickerRef.current = null;
    }

    // Connect with new tokens
    const ticker = new KiteTicker();
    ticker.connect(tokens, handleTicks);
    tickerRef.current = ticker;
    subscribedTokensRef.current = tokens;
  }, [visibleChain, session, handleTicks]);

  // OI Snapshots: capture every 15 min during market hours, calculate velocity
  useEffect(() => {
    if (!session || !isMarketLive()) return;

    // Load today's snapshots and clean old ones
    cleanOldSnapshots();
    getTodaySnapshots().then((snaps) => {
      setSnapshots(snaps);
      // Calculate initial velocity
      if (oiData.size > 0 && snaps.length > 0) {
        setOiVelocity(calculateVelocity(oiData, snaps));
      }
    });

    // Set up interval to capture snapshots
    const capture = async () => {
      if (!isMarketLive() || oiData.size === 0) return;
      const snaps = await getTodaySnapshots();
      if (shouldTakeSnapshot(snaps)) {
        await saveOiSnapshot(oiData);
        const updatedSnaps = await getTodaySnapshots();
        setSnapshots(updatedSnaps);
      }
      // Recalculate velocity
      const latestSnaps = await getTodaySnapshots();
      if (latestSnaps.length > 0) {
        setOiVelocity(calculateVelocity(oiData, latestSnaps));
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
  }, [session, oiData.size > 0]);

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
    if (!session || chain.length === 0 || isMarketLive()) return;

    // Build a key from the visible strikes to detect when ATM shifts
    const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
    const start = Math.max(0, atmIndex - 15);
    const end = Math.min(chain.length, atmIndex + 16);
    const strikes = chain.slice(start, end);
    const fetchKey = `${selectedExpiry}_${strikes[0]?.strike}_${strikes[strikes.length - 1]?.strike}`;

    // Skip if we already fetched for this exact range
    if (quoteFetchedRef.current === fetchKey) return;
    quoteFetchedRef.current = fetchKey;

    const instruments: string[] = ['NSE:NIFTY 50'];
    strikes.forEach((row) => {
      if (row.ce) instruments.push(`NFO:${row.ce.tradingsymbol}`);
      if (row.pe) instruments.push(`NFO:${row.pe.tradingsymbol}`);
    });

    console.log(`[Trades] Fetching quotes for ${instruments.length} instruments (strikes ${strikes[0]?.strike}–${strikes[strikes.length - 1]?.strike})`);

    fetchQuotes(instruments).then((quotes) => {
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

      const niftyQuote = quotes.get('NSE:NIFTY 50');
      if (niftyQuote) setNiftySpot(niftyQuote.last_price);

      // Log any missing instruments
      const missing: string[] = [];
      strikes.forEach((row) => {
        if (row.ce && !quotes.has(`NFO:${row.ce.tradingsymbol}`)) missing.push(`NFO:${row.ce.tradingsymbol}`);
        if (row.pe && !quotes.has(`NFO:${row.pe.tradingsymbol}`)) missing.push(`NFO:${row.pe.tradingsymbol}`);
      });
      if (missing.length > 0) console.warn(`[Trades] Missing quotes for: ${missing.join(', ')}`);

      console.log(`[Trades] Got quotes for ${priceMap.size} options, spot: ${niftyQuote?.last_price}`);

      // Update cache in IndexedDB
      const cacheKey = `oc_ltp_${selectedExpiry}`;
      const pricesObj: Record<string, number> = {};
      priceMap.forEach((v, k) => { pricesObj[String(k)] = v; });
      const oiObj: Record<string, number> = {};
      oiMap.forEach((v, k) => { oiObj[String(k)] = v; });
      const closeObj: Record<string, number> = {};
      closeMap.forEach((v, k) => { closeObj[String(k)] = v; });
      cacheSet(cacheKey, { prices: pricesObj, oi: oiObj, close: closeObj, spot: niftyQuote?.last_price || 0 });
    }).catch((err) => {
      console.error('[Trades] Failed to fetch quotes:', err);
      // Reset so it can retry
      quoteFetchedRef.current = '';
      // Fallback to IndexedDB cache
      const cacheKey = `oc_ltp_${selectedExpiry}`;
      cacheGet<{ prices: Record<string, number>; oi: Record<string, number>; close?: Record<string, number>; spot: number }>(cacheKey).then((cached) => {
        if (cached) {
          setLivePrices(new Map(Object.entries(cached.prices).map(([k, v]) => [Number(k), v])));
          setOiData(new Map(Object.entries(cached.oi || {}).map(([k, v]) => [Number(k), v])));
          if (cached.close) setClosePrices(new Map(Object.entries(cached.close).map(([k, v]) => [Number(k), v])));
          if (cached.spot) setNiftySpot(cached.spot);
        }
      });
    });
  }, [chain, atmStrike, session, selectedExpiry]);

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


  if (!session) {
    return (
      <div className="card">
        <div className="card__icon"><TradesIcon /></div>
        <h3 className="card__title">Not Connected</h3>
        <p className="card__description">Login to Kite Connect from the Profile page to view the option chain.</p>
        <button className="btn btn--primary" onClick={() => navigate('/profile')} style={{ marginTop: 12 }}>
          Login back
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Global Expiry Selector */}
      {expiries.length > 0 && (
        <div className="oc-expiry-bar">
          <span className="oc-expiry-bar__label">Expiry</span>
          <select
            className="option-chain-expiry-select"
            value={selectedExpiry}
            onChange={(e) => setSelectedExpiry(e.target.value)}
          >
            {expiries.map((exp) => (
              <option key={exp} value={exp}>
                {new Date(exp).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </option>
            ))}
          </select>
          {daysToExpiry !== undefined && (
            <span className="oc-expiry-bar__days">{daysToExpiry === 0 ? 'Expiry today' : `${daysToExpiry}d to expiry`}</span>
          )}
        </div>
      )}

      {/* Option Chain Card */}
      <div className="card option-chain-card">
        <div className="trap-card-header">
          <div className="trap-card-header__left">
            <div className="card__icon"><TradesIcon /></div>
            <h3 className="card__title" style={{ marginBottom: 0 }}>NIFTY Option Chain</h3>
          </div>
        </div>

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
                  return (
                    <tr key={row.strike} className={isAtm ? 'oc-row--atm' : ''} style={{ position: 'relative' }}>
                      <td className={`oc-cell-oi oc-cell-oi--ce ${ceItm ? 'oc-cell--itm-ce' : ''}`}>
                        <span className="oc-oi-content">
                          {ceOi !== undefined ? ceOi.toLocaleString('en-IN') : '-'}
                          {ceOiChg && <span className={`oc-cell-chg ${ceOiChg.color}`}>{ceOiChg.pct >= 0 ? '+' : ''}{ceOiChg.pct.toFixed(2)}%</span>}
                        </span>
                      </td>
                      <td className={`oc-cell-ltp ${ceItm ? 'oc-cell--itm-ce' : ''}`}>
                        {cePrice !== null ? cePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        {ceChg && <span className={`oc-cell-chg ${ceChg.color}`}>{ceChg.pct >= 0 ? '+' : ''}{ceChg.pct.toFixed(2)}%</span>}
                      </td>
                      <td className="oc-cell-strike">
                        <div className="oc-strike-bars">
                          <div className="oc-oi-bar oc-oi-bar--ce" style={{ width: `${maxOi > 0 && ceOi ? (ceOi / maxOi) * 150 : 0}px` }} />
                          <div className="oc-oi-bar oc-oi-bar--pe" style={{ width: `${maxOi > 0 && peOi ? (peOi / maxOi) * 150 : 0}px` }} />
                        </div>
                        {row.strike}
                      </td>
                      <td className={`oc-cell-ltp ${peItm ? 'oc-cell--itm-pe' : ''}`}>
                        {pePrice !== null ? pePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        {peChg && <span className={`oc-cell-chg ${peChg.color}`}>{peChg.pct >= 0 ? '+' : ''}{peChg.pct.toFixed(2)}%</span>}
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

      {/* OI Bar Chart Card */}
      {!loading && !error && visibleChain.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <div className="card__icon"><TradesIcon /></div>
              <h3 className="card__title" style={{ marginBottom: 0 }}>OI Chart <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)' }}>(daily changes)</span></h3>
              <button className="trap-info-btn" onClick={() => setShowOiChartInfo(!showOiChartInfo)} title="How to read this chart">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>
          {showOiChartInfo && (
            <div className="trap-info-detail">
              <h4>How to Read the OI Chart</h4>
              <p>This chart shows Open Interest (OI) for each strike as vertical bars. Higher bars mean more contracts are open at that strike.</p>

              <h5>Bar Colors</h5>
              <ul>
                <li><strong>Green bars (left)</strong> — CE (Call) Open Interest</li>
                <li><strong>Red bars (right)</strong> — PE (Put) Open Interest</li>
              </ul>

              <h5>OI Change Indicators</h5>
              <ul>
                <li><strong>Cross-hatched top section</strong> — OI added since yesterday's close (new positions built today)</li>
                <li><strong>Dashed marker above a shorter bar</strong> — OI decreased from yesterday (positions unwound)</li>
              </ul>

              <h5>Glow Effect</h5>
              <p>Bars with a glowing border are <strong>volume-confirmed</strong> — both OI changed significantly AND high trading volume backs it. These are real institutional moves, not noise.</p>

              <h5>Velocity Arrows (▲/▼)</h5>
              <p>Appear during live market when OI changes rapidly (5%+ in 10 minutes). Green ▲ = fast buildup. Red ▼ = fast unwinding.</p>

              <h5>Shaded Zone (Expected Range)</h5>
              <p>The lightly tinted area with dashed borders shows where NIFTY is expected to stay (based on ATM straddle premium). OI walls <strong>outside</strong> this zone are stronger — price is unlikely to reach them.</p>

              <h5>Key Takeaways</h5>
              <ul>
                <li><strong>Tallest CE bar</strong> = strongest resistance (call sellers defending that level)</li>
                <li><strong>Tallest PE bar</strong> = strongest support (put sellers defending that level)</li>
                <li><strong>ATM dashed line</strong> = current NIFTY spot position</li>
                <li><strong>Glowing + velocity ▲</strong> = wall being built RIGHT NOW by institutions</li>
              </ul>
            </div>
          )}
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
              <div className="oc-chart__bars" onClick={() => setSelectedChartStrike(null)}>
                <div className="oc-chart__gridlines">
                  {[...Array(9)].map((_, i) => (
                    <div key={i} className="oc-chart__gridline" style={{ top: `${(i / 8) * 100}%` }} />
                  ))}
                </div>
                {/* Expected Range Overlay */}
                {expectedMove > 0 && niftySpot > 0 && (() => {
                  const totalStrikes = visibleChain.length;
                  if (totalStrikes < 2) return null;
                  // Find first and last strike index within expected range
                  let startIdx = -1;
                  let endIdx = -1;
                  for (let i = 0; i < totalStrikes; i++) {
                    const s = visibleChain[i].strike;
                    if (s >= (niftySpot - expectedMove) && s <= (niftySpot + expectedMove)) {
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
                        <div className="oc-chart__tooltip-title">{row.strike}</div>
                        <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-ce">CE OI:</span>
                          <span>{ceOi.toLocaleString('en-IN')}</span>
                        </div>
                        {cePrevOi > 0 && <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-ce">CE Chg:</span>
                          <span className={ceOi >= cePrevOi ? 'positive' : 'negative'}>{ceOi >= cePrevOi ? '+' : ''}{(((ceOi - cePrevOi) / cePrevOi) * 100).toFixed(2)}%</span>
                        </div>}
                        {ceVelocity && <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-ce">CE Vel:</span>
                          <span className={ceVelocity.changePct >= 0 ? 'positive' : 'negative'}>{ceVelocity.changePct >= 0 ? '+' : ''}{ceVelocity.changePct.toFixed(2)}% / {ceVelocity.intervalMinutes}m</span>
                        </div>}
                        <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-pe">PE OI:</span>
                          <span>{peOi.toLocaleString('en-IN')}</span>
                        </div>
                        {pePrevOi > 0 && <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-pe">PE Chg:</span>
                          <span className={peOi >= pePrevOi ? 'positive' : 'negative'}>{peOi >= pePrevOi ? '+' : ''}{(((peOi - pePrevOi) / pePrevOi) * 100).toFixed(2)}%</span>
                        </div>}
                        {peVelocity && <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-pe">PE Vel:</span>
                          <span className={peVelocity.changePct >= 0 ? 'positive' : 'negative'}>{peVelocity.changePct >= 0 ? '+' : ''}{peVelocity.changePct.toFixed(2)}% / {peVelocity.intervalMinutes}m</span>
                        </div>}
                        <div className="oc-chart__tooltip-row">
                          <span>PCR:</span>
                          <span>{ceOi > 0 ? (peOi / ceOi).toFixed(2) : '-'}</span>
                        </div>
                      </div>
                      );
                    })()}
                    {/* Velocity indicators */}
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
                    <div className="oc-chart__bar-group">
                      <div className="oc-chart__bar-wrapper">
                        {ceDecreased && <div className="oc-chart__bar-prev oc-chart__bar-prev--ce" style={{ height: `${cePrevMarker}%` }} />}
                        <div className={`oc-chart__bar oc-chart__bar--ce ${ceConfirmed ? 'oc-chart__bar--confirmed' : ''}`} style={{ height: `${ceHeight}%` }}>
                          {ceOi > cePrevOi && cePrevOi > 0 && <div className="oc-chart__bar-added oc-chart__bar-added--ce" style={{ height: `${((ceHeight - cePrevHeight) / ceHeight) * 100}%` }} />}
                        </div>
                      </div>
                      <div className="oc-chart__bar-wrapper">
                        {peDecreased && <div className="oc-chart__bar-prev oc-chart__bar-prev--pe" style={{ height: `${pePrevMarker}%` }} />}
                        <div className={`oc-chart__bar oc-chart__bar--pe ${peConfirmed ? 'oc-chart__bar--confirmed' : ''}`} style={{ height: `${peHeight}%` }}>
                          {peOi > pePrevOi && pePrevOi > 0 && <div className="oc-chart__bar-added oc-chart__bar-added--pe" style={{ height: `${((peHeight - pePrevHeight) / peHeight) * 100}%` }} />}
                        </div>
                      </div>
                    </div>
                    <span className="oc-chart__strike-label">{row.strike % 100 === 0 ? row.strike : ''}</span>
                  </div>
                );
              })}
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

      {/* Trap Analyzer */}
      {!loading && !error && visibleChain.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <div className="card__icon"><TradesIcon /></div>
              <h3 className="card__title" style={{ marginBottom: 0 }}>Position Analyzer</h3>
              <TrapInfoPanel show={showTrapInfo} onToggle={setShowTrapInfo} />
            </div>
          </div>
          {showTrapInfo && <TrapInfoDetail />}
          <TrapAnalyzer
            chain={visibleChain}
            oiData={oiData}
            prevDayOi={prevDayOi}
            closePrices={closePrices}
            livePrices={livePrices}
            spotPrice={niftySpot}
            atmStrike={atmStrike}
            daysToExpiry={daysToExpiry}
          />
        </div>
      )}

      {/* Best Strikes - Edge Score Recommendations */}
      {!loading && !error && visibleChain.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="trap-card-header">
            <div className="trap-card-header__left">
              <div className="card__icon"><TradesIcon /></div>
              <h3 className="card__title" style={{ marginBottom: 0 }}>Best Strikes</h3>
              <button className="trap-info-btn" onClick={() => setShowBestStrikesInfo(!showBestStrikesInfo)} title="How Best Strikes works">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>
          {showBestStrikesInfo && (
            <div className="trap-info-detail">
              <h4>How Best Strikes Works</h4>
              <p>Recommends the top 3 strikes for selling CE and PE options based on a combined Edge Score.</p>

              <h5>Edge Score Formula</h5>
              <p>Each strike is scored by combining:</p>
              <ul>
                <li><strong>POP (Probability of Profit)</strong> — Based on distance from spot vs expected move. Farther OTM = higher probability that price won't reach your strike.</li>
                <li><strong>OI Wall Strength</strong> — Strikes with heavy OI (1.5x+ above average) have institutional defense. Sellers at these strikes are protected by the wall.</li>
                <li><strong>Max Pain Alignment</strong> — Selling CE above max pain or PE below max pain means price gravitates away from your strike.</li>
                <li><strong>Distance from Spot</strong> — More distance = more safety margin before your strike is threatened.</li>
                <li><strong>Premium Value</strong> — Higher premium = better reward for the risk taken.</li>
              </ul>

              <h5>What the Metrics Mean</h5>
              <ul>
                <li><strong>POP 70%+</strong> — Strong probability. Price has a 70%+ chance of NOT reaching this strike.</li>
                <li><strong>OI Wall 1.5x+</strong> — Significant institutional defense at this level.</li>
                <li><strong>Premium</strong> — The amount you'd collect per lot for selling at this strike.</li>
                <li><strong>Distance</strong> — Points between spot and your strike.</li>
              </ul>

              <h5>How to Use</h5>
              <ul>
                <li>Pick strikes with high Edge Score — they balance risk and reward.</li>
                <li>Higher POP = safer but lower premium.</li>
                <li>OI Wall = bonus protection on top of distance.</li>
                <li>Avoid strikes inside the Expected Range (market likely to reach them).</li>
              </ul>

              <h5>Important</h5>
              <p>These are recommendations based on current OI data, not guaranteed profits. Always manage risk with stop losses and position sizing.</p>
            </div>
          )}
          <BestStrikes
            chain={visibleChain}
            oiData={oiData}
            livePrices={livePrices}
            spotPrice={niftySpot}
            atmStrike={atmStrike}
          />
        </div>
      )}
    </div>
  );
};

export default OptionChain;
