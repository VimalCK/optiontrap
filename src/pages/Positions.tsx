import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TradesIcon } from '@/components/icons/Icons';
import { getPositions, exitPosition, Position } from '@/services/positions';
import { getSession, clearSession } from '@/services/kiteAuth';
import { notifySessionChange } from '@/hooks/useKiteSession';
import { fetchQuotes, fetchPositions, KitePosition, KitePositions } from '@/services/kiteApi';
import { KiteTicker, Tick } from '@/services/kiteTicker';
import { isMarketLive } from '@/utils/marketStatus';
import '@/styles/positions.css';

type PositionsMode = 'paper' | 'live';

const PaperPositions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const tickerRef = useRef<KiteTicker | null>(null);

  const loadPositions = useCallback(async () => {
    const pos = await getPositions();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const filtered = pos.filter((p) => {
      if (!p.exited || !p.exitTime) return true;
      const exitDate = new Date(p.exitTime);
      exitDate.setHours(0, 0, 0, 0);
      return exitDate.getTime() >= today.getTime();
    });
    setPositions(filtered);
    setLoading(false);
  }, []);

  useEffect(() => { loadPositions(); }, [loadPositions]);

  useEffect(() => {
    const session = getSession();
    if (!session || positions.length === 0) return;

    const tokens = positions.map((p) => p.instrumentToken);

    if (isMarketLive()) {
      const ticker = new KiteTicker();
      ticker.connect(tokens, (ticks: Tick[]) => {
        setLivePrices((prev) => {
          const next = new Map(prev);
          ticks.forEach((t) => { next.set(t.instrumentToken, t.lastPrice); });
          return next;
        });
      });
      tickerRef.current = ticker;
      return () => { ticker.disconnect(); tickerRef.current = null; };
    } else {
      const instruments = positions.map((p) => `NFO:${p.tradingsymbol}`);
      fetchQuotes(instruments).then((quotes) => {
        const priceMap = new Map<number, number>();
        positions.forEach((p) => {
          const q = quotes.get(`NFO:${p.tradingsymbol}`);
          if (q) priceMap.set(p.instrumentToken, q.last_price);
        });
        setLivePrices(priceMap);
      }).catch(() => {});
    }
  }, [positions]);

  const handleExit = async (id: string, instrumentToken: number) => {
    const exitPrice = livePrices.get(instrumentToken) || 0;
    await exitPosition(id, exitPrice);
    await loadPositions();
  };

  const getPnL = (pos: Position): { value: number; pct: number } => {
    const currentPrice = pos.exited ? pos.exitPrice! : livePrices.get(pos.instrumentToken);
    if (currentPrice === undefined) return { value: 0, pct: 0 };
    const pnl = pos.side === 'BUY'
      ? (currentPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - currentPrice) * pos.quantity;
    const pct = pos.entryPrice > 0
      ? ((pos.side === 'BUY' ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice) / pos.entryPrice) * 100
      : 0;
    return { value: pnl, pct };
  };

  const totalPnL = positions.reduce((sum, pos) => sum + getPnL(pos).value, 0);

  if (loading) return <div className="card"><p className="card__description">Loading positions...</p></div>;

  if (positions.length === 0) {
    return (
      <div className="card">
        <div className="card__icon"><TradesIcon /></div>
        <h3 className="card__title">No Open Positions</h3>
        <p className="card__description">Click on any LTP cell in the Option Chain to add a position.</p>
      </div>
    );
  }

  return (
    <>
      {/* Summary */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="positions-summary">
          <div className="positions-summary__item">
            <span className="positions-summary__label">Total P&L</span>
            <span className={`positions-summary__value ${totalPnL > 0 ? 'positive' : totalPnL < 0 ? 'negative' : ''}`}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Positions Table */}
      <div className="card">
        <table className="positions-table">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Avg</th>
              <th>LTP/Exit</th>
              <th>P&L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const pnl = getPnL(pos);
              const ltp = pos.exited ? pos.exitPrice : livePrices.get(pos.instrumentToken);
              return (
                <tr key={pos.id} className={pos.exited ? 'positions-table__row--exited' : ''}>
                  <td>
                    <span className="positions-table__instrument">
                      <span className="positions-table__strike">{pos.strike}</span>
                      <span className={`positions-table__type positions-table__type--${pos.optionType.toLowerCase()}`}>{pos.optionType}</span>
                    </span>
                  </td>
                  <td><span className={`positions-table__side positions-table__side--${pos.side.toLowerCase()}`}>{pos.side}</span></td>
                  <td>{pos.quantity}</td>
                  <td>{pos.entryPrice.toFixed(2)}</td>
                  <td>{pos.exited ? pos.exitPrice!.toFixed(2) : (ltp !== undefined ? ltp.toFixed(2) : '-')}</td>
                  <td className={pnl.value > 0 ? 'positive' : pnl.value < 0 ? 'negative' : ''}>
                    {pnl.value >= 0 ? '+' : ''}{pnl.value.toFixed(2)}
                    <span className="positions-table__pct"> ({pnl.pct >= 0 ? '+' : ''}{pnl.pct.toFixed(2)}%)</span>
                  </td>
                  <td>
                    {!pos.exited && (
                      <button className="positions-table__exit" onClick={() => handleExit(pos.id, pos.instrumentToken)} title="Exit position">
                        EXIT
                      </button>
                    )}
                    {pos.exited && <span className="positions-table__exited-badge">EXITED</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

type LiveView = 'net' | 'day';

const LivePositions: React.FC = () => {
  const [positions, setPositions] = useState<KitePositions | null>(null);
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<LiveView>('net');
  const tickerRef = useRef<KiteTicker | null>(null);
  const [, setSession] = useState(getSession);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPositions();
      setPositions(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load positions';
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
  }, []);

  useEffect(() => { load(); }, [load]);

  // Subscribe live prices via WebSocket for open positions
  useEffect(() => {
    const session = getSession();
    if (!session || !positions) return;

    const allPos = [...positions.net, ...positions.day];
    const tokens = [...new Set(allPos.map((p) => p.instrument_token))];
    if (tokens.length === 0) return;

    if (isMarketLive()) {
      const ticker = new KiteTicker();
      ticker.connect(tokens, (ticks: Tick[]) => {
        setLivePrices((prev) => {
          const next = new Map(prev);
          ticks.forEach((t) => next.set(t.instrumentToken, t.lastPrice));
          return next;
        });
      });
      tickerRef.current = ticker;
      return () => { ticker.disconnect(); tickerRef.current = null; };
    }
  }, [positions]);

  if (loading) return <div className="card"><p className="card__description">Loading live positions...</p></div>;

  if (error) {
    return (
      <div className="card holdings-error">
        <p>{error}</p>
        <button className="btn btn--primary" onClick={load} style={{ marginTop: 12 }}>Retry</button>
      </div>
    );
  }

  if (!positions) return null;

  const rows = view === 'net' ? positions.net : positions.day;
  const openRows   = rows.filter((p) => p.quantity !== 0);
  const closedRows = rows.filter((p) => p.quantity === 0);

  const totalPnL    = rows.reduce((s, p) => s + p.pnl, 0);
  const totalM2M    = rows.reduce((s, p) => s + p.m2m, 0);
  const unrealised  = rows.reduce((s, p) => s + p.unrealised, 0);
  const realised    = rows.reduce((s, p) => s + p.realised, 0);

  const fmt = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const renderTable = (list: KitePosition[], title?: string) => {
    if (list.length === 0) return null;
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        {title && <h4 className="live-positions__section-title">{title}</h4>}
        <table className="positions-table live-positions-table">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Avg</th>
              <th>LTP</th>
              <th>P&L</th>
              <th>Unrealised</th>
              <th>Realised</th>
            </tr>
          </thead>
          <tbody>
            {list.map((pos) => {
              const ltp = livePrices.get(pos.instrument_token) ?? pos.last_price;
              return (
                <tr key={`${pos.exchange}:${pos.tradingsymbol}`}>
                  <td>
                    <span className="positions-table__instrument">
                      <span className="live-positions__symbol">{pos.tradingsymbol}</span>
                      <span className="live-positions__exchange">{pos.exchange}</span>
                    </span>
                  </td>
                  <td><span className="live-positions__product">{pos.product}</span></td>
                  <td className={pos.quantity > 0 ? 'positive' : pos.quantity < 0 ? 'negative' : ''}>
                    {pos.quantity > 0 ? '+' : ''}{pos.quantity}
                  </td>
                  <td>{pos.average_price > 0 ? pos.average_price.toFixed(2) : '-'}</td>
                  <td>{ltp > 0 ? ltp.toFixed(2) : '-'}</td>
                  <td className={pos.pnl > 0 ? 'positive' : pos.pnl < 0 ? 'negative' : ''}>
                    {fmt(pos.pnl)}
                  </td>
                  <td className={pos.unrealised > 0 ? 'positive' : pos.unrealised < 0 ? 'negative' : ''}>
                    {fmt(pos.unrealised)}
                  </td>
                  <td className={pos.realised > 0 ? 'positive' : pos.realised < 0 ? 'negative' : ''}>
                    {fmt(pos.realised)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  if (rows.length === 0) {
    return (
      <>
        <div className="live-positions__controls">
          <div className="positions-mode-tabs">
            {(['net', 'day'] as LiveView[]).map((v) => (
              <button key={v} className={`positions-mode-tab ${view === v ? 'positions-mode-tab--active' : ''}`} onClick={() => setView(v)}>
                {v === 'net' ? 'Net Positions' : 'Day Positions'}
              </button>
            ))}
          </div>
          <button className="oc-refresh-btn" onClick={load}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
        </div>
        <div className="card">
          <h3 className="card__title">No {view === 'net' ? 'Net' : 'Day'} Positions</h3>
          <p className="card__description">No open positions for the selected view.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Controls */}
      <div className="live-positions__controls">
        <div className="positions-mode-tabs">
          {(['net', 'day'] as LiveView[]).map((v) => (
            <button key={v} className={`positions-mode-tab ${view === v ? 'positions-mode-tab--active' : ''}`} onClick={() => setView(v)}>
              {v === 'net' ? 'Net Positions' : 'Day Positions'}
            </button>
          ))}
        </div>
        <button className="oc-refresh-btn" onClick={load}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="positions-summary">
          <div className="positions-summary__item">
            <span className="positions-summary__label">Total P&L</span>
            <span className={`positions-summary__value ${totalPnL > 0 ? 'positive' : totalPnL < 0 ? 'negative' : ''}`}>{fmt(totalPnL)}</span>
          </div>
          <div className="positions-summary__item">
            <span className="positions-summary__label">M2M</span>
            <span className={`positions-summary__value ${totalM2M > 0 ? 'positive' : totalM2M < 0 ? 'negative' : ''}`}>{fmt(totalM2M)}</span>
          </div>
          <div className="positions-summary__item">
            <span className="positions-summary__label">Unrealised</span>
            <span className={`positions-summary__value ${unrealised > 0 ? 'positive' : unrealised < 0 ? 'negative' : ''}`}>{fmt(unrealised)}</span>
          </div>
          <div className="positions-summary__item">
            <span className="positions-summary__label">Realised</span>
            <span className={`positions-summary__value ${realised > 0 ? 'positive' : realised < 0 ? 'negative' : ''}`}>{fmt(realised)}</span>
          </div>
        </div>
      </div>

      {renderTable(openRows, openRows.length > 0 && closedRows.length > 0 ? 'Open' : undefined)}
      {renderTable(closedRows, closedRows.length > 0 && openRows.length > 0 ? 'Closed Today' : undefined)}
    </>
  );
};

const Positions: React.FC<{ hideHeader?: boolean }> = ({ hideHeader = false }) => {
  const [mode, setMode] = useState<PositionsMode>('paper');

  return (
    <div>
      {!hideHeader && (
        <div className="page-header">
          <div className="positions-header-row">
            <div>
              <h1 className="page-header__title">Positions</h1>
              <p className="page-header__subtitle">
                {mode === 'paper' ? 'Simulated paper trading positions' : 'Live market positions from Kite'}
              </p>
            </div>
            <div className="positions-mode-tabs">
              {(['paper', 'live'] as PositionsMode[]).map((m) => (
                <button key={m} className={`positions-mode-tab ${mode === m ? 'positions-mode-tab--active' : ''}`} onClick={() => setMode(m)}>
                  <span className={`positions-mode-dot positions-mode-dot--${m}`} />
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* When hideHeader, show the mode toggle inline */}
      {hideHeader && (
        <div className="positions-mode-tabs" style={{ marginBottom: 20 }}>
          {(['paper', 'live'] as PositionsMode[]).map((m) => (
            <button key={m} className={`positions-mode-tab ${mode === m ? 'positions-mode-tab--active' : ''}`} onClick={() => setMode(m)}>
              <span className={`positions-mode-dot positions-mode-dot--${m}`} />
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      )}

      {mode === 'paper' ? <PaperPositions /> : <LivePositions />}
    </div>
  );
};

export default Positions;
