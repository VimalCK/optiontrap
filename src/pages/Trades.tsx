import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { TradesIcon } from '@/components/icons/Icons';
import { getSession } from '@/services/kiteAuth';
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

const Trades: React.FC = () => {
  const [options, setOptions] = useState<OptionInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [openPrices, setOpenPrices] = useState<Map<number, number>>(new Map());
  const [niftySpot, setNiftySpot] = useState<number>(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const tickerRef = useRef<KiteTicker | null>(null);
  const subscribedTokensRef = useRef<number[]>([]);

  const session = getSession();

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
    setOpenPrices((prev) => {
      const next = new Map(prev);
      ticks.forEach((t) => {
        if (t.openPrice !== undefined && t.openPrice > 0 && t.instrumentToken !== NIFTY_INDEX_TOKEN) {
          next.set(t.instrumentToken, t.openPrice);
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
      setError(err instanceof Error ? err.message : 'Failed to load option chain');
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

  // Connect/reconnect WebSocket when visible chain changes
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
    setIsStreaming(true);

    return () => {
      // Cleanup handled by the top-level unmount effect
    };
  }, [visibleChain, session, handleTicks]);

  // Helper to get live price or fallback to CSV price
  const getPrice = (instrument: OptionInstrument | null): number | null => {
    if (!instrument) return null;
    const live = livePrices.get(instrument.instrumentToken);
    if (live !== undefined && live > 0) return live;
    return instrument.lastPrice > 0 ? instrument.lastPrice : null;
  };

  // Helper to get price color class based on open price comparison
  const getPriceColor = (instrument: OptionInstrument | null): string => {
    if (!instrument) return '';
    const ltp = livePrices.get(instrument.instrumentToken);
    const open = openPrices.get(instrument.instrumentToken);
    if (ltp === undefined || open === undefined || open === 0) return '';
    if (ltp > open) return 'positive';
    if (ltp < open) return 'negative';
    return '';
  };

  if (!session) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-header__title">Trades</h1>
          <p className="page-header__subtitle">Execute and manage your option trades</p>
        </div>
        <div className="card">
          <div className="card__icon"><TradesIcon /></div>
          <h3 className="card__title">Not Connected</h3>
          <p className="card__description">Login to Kite Connect from the Profile page to view the option chain.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">
          Trades
          {isStreaming && isMarketLive() && <span className="live-badge">● LIVE</span>}
        </h1>
        <p className="page-header__subtitle">
          NIFTY Option Chain{niftySpot > 0 ? ` · Spot: ${niftySpot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
        </p>
      </div>

      {/* Option Chain Card */}
      <div className="card option-chain-card">
        <div className="option-chain-header">
          <div>
            <div className="card__icon"><TradesIcon /></div>
            <h3 className="card__title">NIFTY Option Chain</h3>
          </div>
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
                  <th className="oc-header-ce">CALLS</th>
                  <th className="oc-header-strike">STRIKE</th>
                  <th className="oc-header-pe">PUTS</th>
                </tr>
              </thead>
              <tbody>
                {visibleChain.map((row) => {
                  const isAtm = row.strike === atmStrike;
                  const cePrice = getPrice(row.ce);
                  const pePrice = getPrice(row.pe);
                  return (
                    <tr key={row.strike} className={isAtm ? 'oc-row--atm' : ''}>
                      <td className={`oc-cell-ltp ${getPriceColor(row.ce)}`}>
                        {cePrice !== null ? cePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="oc-cell-strike">{row.strike}</td>
                      <td className={`oc-cell-ltp ${getPriceColor(row.pe)}`}>
                        {pePrice !== null ? pePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
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
    </div>
  );
};

export default Trades;
