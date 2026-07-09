import React, { useState, useEffect, useCallback } from 'react';
import { getPositions, exitPosition, Position } from '@/services/positions';

import { fetchQuotes, fetchPositions, KitePosition, KitePositions } from '@/services/kiteApi';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { isMarketLive } from '@/utils/marketStatus';
import '@/styles/positions.css';

type PositionsMode = 'paper' | 'live';

const PaperPositions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);

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
    if (positions.length === 0) return;

    const tokens = positions.map((p) => p.instrumentToken);

    if (isMarketLive()) {
      return tickerSubscribe('paper-positions', tokens, (ticks: Tick[]) => {
        setLivePrices((prev) => {
          const next = new Map(prev);
          ticks.forEach((t) => { next.set(t.instrumentToken, t.lastPrice); });
          return next;
        });
      });
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
        <div className="positions-table-scroll">
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
                      <span className="positions-table__name">{pos.tradingsymbol.replace(/\d.*/,'')}</span>
                      <span className="positions-table__strike">{pos.strike}</span>
                      <span className={`positions-table__type positions-table__type--${pos.optionType.toLowerCase()}`}>{pos.optionType}</span>
                      <span className="positions-table__expiry">{new Date(pos.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPositions();
      setPositions(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load positions';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Subscribe live prices via WebSocket for open positions
  useEffect(() => {
    if (!positions || !isMarketLive()) return;

    const allPos = [...positions.net, ...positions.day];
    const tokens = [...new Set(allPos.filter((p) => p.quantity !== 0).map((p) => p.instrument_token))];
    if (tokens.length === 0) return;

    return tickerSubscribe('live-positions', tokens, (ticks: Tick[]) => {
      setLivePrices((prev) => {
        const next = new Map(prev);
        ticks.forEach((t) => next.set(t.instrumentToken, t.lastPrice));
        return next;
      });
    });
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

  // Recompute P&L from live LTP when available; fall back to API value
  const getLivePnl = (p: KitePosition): { pnl: number; unrealised: number } => {
    const ltp = livePrices.get(p.instrument_token);
    if (ltp !== undefined && p.quantity !== 0) {
      const livePnl = (ltp - p.average_price) * p.quantity;
      return { pnl: livePnl, unrealised: livePnl - p.realised };
    }
    return { pnl: p.pnl, unrealised: p.unrealised };
  };

  const totalPnL    = rows.reduce((s, p) => s + getLivePnl(p).pnl, 0);

  const fmt = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const renderActiveTable = (list: KitePosition[]) => {
    if (list.length === 0) return null;
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 className="live-positions__section-title">Active</h4>
        <div className="positions-table-scroll">
        <table className="positions-table live-positions-table">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Product</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Avg</th>
              <th>LTP</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {list.map((pos) => {
              const ltp = livePrices.get(pos.instrument_token) ?? pos.last_price;
              const { pnl: livePnl } = getLivePnl(pos);
              const side = pos.quantity > 0 ? 'BUY' : 'SELL';
              return (
                <tr key={`${pos.exchange}:${pos.tradingsymbol}`}>
                  <td>
                    <span className="positions-table__instrument">
                      <span className="live-positions__symbol">{pos.tradingsymbol}</span>
                      <span className="live-positions__exchange">{pos.exchange}</span>
                    </span>
                  </td>
                  <td><span className="live-positions__product">{pos.product}</span></td>
                  <td><span className={`positions-table__side positions-table__side--${side.toLowerCase()}`}>{side}</span></td>
                  <td>{Math.abs(pos.quantity)}</td>
                  <td>{pos.average_price > 0 ? pos.average_price.toFixed(2) : '-'}</td>
                  <td>{ltp > 0 ? ltp.toFixed(2) : '-'}</td>
                  <td className={livePnl > 0 ? 'positive' : livePnl < 0 ? 'negative' : ''}>
                    {fmt(livePnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    );
  };

  const renderExitedTable = (list: KitePosition[]) => {
    if (list.length === 0) return null;
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 className="live-positions__section-title">Exited</h4>
        <div className="positions-table-scroll">
        <table className="positions-table live-positions-table">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {list.map((pos) => {
              const { pnl: livePnl } = getLivePnl(pos);
              return (
                <tr key={`${pos.exchange}:${pos.tradingsymbol}`} className="positions-table__row--exited">
                  <td>
                    <span className="positions-table__instrument">
                      <span className="live-positions__symbol">{pos.tradingsymbol}</span>
                      <span className="live-positions__exchange">{pos.exchange}</span>
                    </span>
                  </td>
                  <td className={livePnl > 0 ? 'positive' : livePnl < 0 ? 'negative' : ''}>
                    {fmt(livePnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
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
        </div>
      </div>

      {renderActiveTable(openRows)}
      {renderExitedTable(closedRows)}
    </>
  );
};

const Positions: React.FC<{ hideHeader?: boolean }> = ({ hideHeader = false }) => {
  const [mode, setMode] = useState<PositionsMode>(() =>
    (localStorage.getItem('optiontrap_order_mode') as PositionsMode) || 'paper'
  );

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
