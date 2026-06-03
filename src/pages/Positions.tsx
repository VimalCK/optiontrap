import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TradesIcon } from '@/components/icons/Icons';
import { getPositions, exitPosition, Position } from '@/services/positions';
import { getSession } from '@/services/kiteAuth';
import { fetchQuotes } from '@/services/kiteApi';
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

const LivePositions: React.FC = () => (
  <div className="card positions-coming-soon">
    <div className="positions-coming-soon__icon">📡</div>
    <h4 className="positions-coming-soon__title">Live Positions</h4>
    <p className="positions-coming-soon__desc">
      Real market positions will be pulled from Kite Positions API once implemented.
      Switch to <strong>Paper</strong> to view your simulated positions.
    </p>
  </div>
);

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
