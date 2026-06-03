import React, { useState, useEffect, useCallback } from 'react';
import { TradesIcon } from '@/components/icons/Icons';
import { getPositions, exitPosition, Position } from '@/services/positions';
import { getSession } from '@/services/kiteAuth';
import { fetchQuotes } from '@/services/kiteApi';
import { KiteTicker, Tick } from '@/services/kiteTicker';
import { isMarketLive } from '@/utils/marketStatus';
import '@/styles/positions.css';

const Positions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const tickerRef = React.useRef<KiteTicker | null>(null);

  const loadPositions = useCallback(async () => {
    const pos = await getPositions();
    setPositions(pos);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  // Fetch live prices for positions
  useEffect(() => {
    const session = getSession();
    if (!session || positions.length === 0) return;

    const tokens = positions.map((p) => p.instrumentToken);

    if (isMarketLive()) {
      // WebSocket for live prices
      const ticker = new KiteTicker();
      ticker.connect(tokens, (ticks: Tick[]) => {
        setLivePrices((prev) => {
          const next = new Map(prev);
          ticks.forEach((t) => {
            next.set(t.instrumentToken, t.lastPrice);
          });
          return next;
        });
      });
      tickerRef.current = ticker;

      return () => {
        ticker.disconnect();
        tickerRef.current = null;
      };
    } else {
      // Fetch quotes for market-closed state
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
    const ltp = livePrices.get(instrumentToken);
    const exitPrice = ltp || 0;
    await exitPosition(id, exitPrice);
    await loadPositions();
  };

  const getPnL = (pos: Position): { value: number; pct: number } => {
    const currentPrice = pos.exited ? pos.exitPrice! : livePrices.get(pos.instrumentToken);
    if (currentPrice === undefined) return { value: 0, pct: 0 };

    let pnl: number;
    if (pos.side === 'BUY') {
      pnl = (currentPrice - pos.entryPrice) * pos.quantity;
    } else {
      pnl = (pos.entryPrice - currentPrice) * pos.quantity;
    }
    const pct = pos.entryPrice > 0 ? ((pos.side === 'BUY' ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice) / pos.entryPrice) * 100 : 0;
    return { value: pnl, pct };
  };

  const totalPnL = positions.reduce((sum, pos) => sum + getPnL(pos).value, 0);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-header__title">Positions</h1>
        </div>
        <div className="card">
          <p className="card__description">Loading positions...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Positions</h1>
        <p className="page-header__subtitle">
          Track your open option positions and monitor P&L
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="card">
          <div className="card__icon"><TradesIcon /></div>
          <h3 className="card__title">No Open Positions</h3>
          <p className="card__description">
            Click on any LTP cell in the Option Chain to add a position.
          </p>
        </div>
      ) : (
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
              <div className="positions-summary__item">
                <span className="positions-summary__label">Open Positions</span>
                <span className="positions-summary__value">{positions.length}</span>
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
                  <th>LTP</th>
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
                      <td>
                        <span className={`positions-table__side positions-table__side--${pos.side.toLowerCase()}`}>{pos.side}</span>
                      </td>
                      <td>{pos.quantity}</td>
                      <td>{pos.entryPrice.toFixed(2)}</td>
                      <td>{ltp !== undefined ? ltp.toFixed(2) : '-'}</td>
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
      )}
    </div>
  );
};

export default Positions;
