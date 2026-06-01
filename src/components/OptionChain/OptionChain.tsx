import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TradesIcon } from '@/components/icons/Icons';
import { getSession, clearSession } from '@/services/kiteAuth';
import { notifySessionChange } from '@/hooks/useKiteSession';
import TrapAnalyzer from '@/components/TrapAnalyzer/TrapAnalyzer';

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
    <p>Each factor contributes to a trap score. The final verdict is:</p>
    <ul>
      <li><strong>Safe</strong> — No significant signals against your position</li>
      <li><strong>Caution</strong> — Some factors suggest risk, but not conclusive</li>
      <li><strong>Likely Trapped</strong> — Multiple strong signals indicate your position may face headwinds</li>
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
  const [prevDayOi, setPrevDayOi] = useState<Map<number, number>>(new Map());
  const [niftySpot, setNiftySpot] = useState<number>(0);
  const [selectedChartStrike, setSelectedChartStrike] = useState<number | null>(null);
  const [showTrapInfo, setShowTrapInfo] = useState(false);
  const tickerRef = useRef<KiteTicker | null>(null);
  const subscribedTokensRef = useRef<number[]>([]);

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
      {/* Option Chain Card */}
      <div className="card option-chain-card">
        <div className="option-chain-header">
          <div>
            <div className="card__icon"><TradesIcon /></div>
            <h3 className="card__title">NIFTY Option Chain</h3>
          </div>
          <div className="option-chain-controls">
            {expiries.length > 0 && (
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
            )}
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
            </div>
          </div>
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
              <div className="oc-chart__bars">
                <div className="oc-chart__gridlines">
                  {[...Array(9)].map((_, i) => (
                    <div key={i} className="oc-chart__gridline" style={{ top: `${(i / 8) * 100}%` }} />
                  ))}
                </div>
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
                return (
                  <div key={row.strike} className={`oc-chart__col ${isAtm ? 'oc-chart__col--atm' : ''} ${selectedChartStrike === row.strike ? 'oc-chart__col--selected' : ''}`} onClick={() => setSelectedChartStrike(selectedChartStrike === row.strike ? null : row.strike)}>
                    {selectedChartStrike === row.strike && (
                      <div className="oc-chart__tooltip">
                        <div className="oc-chart__tooltip-title">{row.strike}</div>
                        <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-ce">CE OI:</span>
                          <span>{ceOi.toLocaleString('en-IN')}</span>
                        </div>
                        {cePrevOi > 0 && <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-ce">CE Chg:</span>
                          <span className={ceOi >= cePrevOi ? 'positive' : 'negative'}>{ceOi >= cePrevOi ? '+' : ''}{(((ceOi - cePrevOi) / cePrevOi) * 100).toFixed(2)}%</span>
                        </div>}
                        <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-pe">PE OI:</span>
                          <span>{peOi.toLocaleString('en-IN')}</span>
                        </div>
                        {pePrevOi > 0 && <div className="oc-chart__tooltip-row">
                          <span className="oc-chart__tooltip-pe">PE Chg:</span>
                          <span className={peOi >= pePrevOi ? 'positive' : 'negative'}>{peOi >= pePrevOi ? '+' : ''}{(((peOi - pePrevOi) / pePrevOi) * 100).toFixed(2)}%</span>
                        </div>}
                        <div className="oc-chart__tooltip-row">
                          <span>PCR:</span>
                          <span>{ceOi > 0 ? (peOi / ceOi).toFixed(2) : '-'}</span>
                        </div>
                      </div>
                    )}
                    <div className="oc-chart__bar-group">
                      <div className="oc-chart__bar-wrapper">
                        {ceDecreased && <div className="oc-chart__bar-prev oc-chart__bar-prev--ce" style={{ height: `${cePrevMarker}%` }} />}
                        <div className="oc-chart__bar oc-chart__bar--ce" style={{ height: `${ceHeight}%` }}>
                          {ceOi > cePrevOi && cePrevOi > 0 && <div className="oc-chart__bar-added oc-chart__bar-added--ce" style={{ height: `${((ceHeight - cePrevHeight) / ceHeight) * 100}%` }} />}
                        </div>
                      </div>
                      <div className="oc-chart__bar-wrapper">
                        {peDecreased && <div className="oc-chart__bar-prev oc-chart__bar-prev--pe" style={{ height: `${pePrevMarker}%` }} />}
                        <div className="oc-chart__bar oc-chart__bar--pe" style={{ height: `${peHeight}%` }}>
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
            chain={chain}
            oiData={oiData}
            prevDayOi={prevDayOi}
            closePrices={closePrices}
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
