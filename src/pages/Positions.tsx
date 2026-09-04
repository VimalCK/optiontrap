import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getPositions, exitPosition, Position } from '@/services/positions';

import { fetchQuotes, fetchPositions, KitePosition, KitePositions } from '@/services/kiteApi';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import { isMarketLive } from '@/utils/marketStatus';
import {
  computeRiskGroups,
  underlyingFromSymbol,
  samplePayoffCurve,
  RiskGroup,
} from '@/services/positionRisk';
import '@/styles/positions.css';

/** Kite quote keys for underlying spot prices, keyed by underlying name. */
const SPOT_QUOTE_KEYS: Record<string, string> = {
  NIFTY: 'NSE:NIFTY 50',
  BANKNIFTY: 'NSE:NIFTY BANK',
  FINNIFTY: 'NSE:NIFTY FIN SERVICE',
  MIDCPNIFTY: 'NSE:NIFTY MID SELECT',
};

function spotQuoteKey(underlying: string): string {
  return SPOT_QUOTE_KEYS[underlying] || `NSE:${underlying}`;
}

const fmtInr = (n: number) =>
  `${n >= 0 ? '+' : ''}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type PositionsMode = 'paper' | 'live';

/**
 * PayoffChart — an SVG expiry payoff curve for a single risk group.
 * Renders the P&L-at-expiry line, a zero axis, breakeven markers, and a
 * marker at the current underlying spot (when available).
 */
const PayoffChart: React.FC<{ group: RiskGroup; spot?: number }> = ({ group, spot }) => {
  const W = 900;
  const H = 460;
  const PAD = { top: 28, right: 28, bottom: 44, left: 78 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const curve = samplePayoffCurve(group, spot);
  const { points, minPrice, maxPrice } = curve;

  // Pad the payoff domain a little so the line doesn't touch the edges.
  const rawMin = Math.min(curve.minPayoff, 0);
  const rawMax = Math.max(curve.maxPayoff, 0);
  const yPad = (rawMax - rawMin) * 0.1 || 1;
  const yMin = rawMin - yPad;
  const yMax = rawMax + yPad;

  const xScale = (price: number) =>
    PAD.left + ((price - minPrice) / (maxPrice - minPrice || 1)) * plotW;
  const yScale = (payoff: number) =>
    PAD.top + (1 - (payoff - yMin) / (yMax - yMin || 1)) * plotH;

  const zeroY = yScale(0);

  // Split the curve into profit (green) and loss (red) segments for fill.
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.price).toFixed(1)} ${yScale(p.payoff).toFixed(1)}`)
    .join(' ');

  const fmtK = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 100000) return `${(n / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return n.toFixed(0);
  };

  return (
    <svg className="payoff-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Payoff curve">
      {/* Zero P&L axis */}
      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} className="payoff-chart__zero" />

      {/* Y axis labels: max, 0, min */}
      {[yMax, 0, yMin].map((v, i) => (
        <text key={i} x={PAD.left - 8} y={yScale(v) + 3} className="payoff-chart__ylabel" textAnchor="end">
          {fmtK(v)}
        </text>
      ))}

      {/* X axis labels: five ticks across the price range */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i, arr) => {
        const v = minPrice + f * (maxPrice - minPrice);
        return (
          <text
            key={i}
            x={xScale(v)}
            y={H - 14}
            className="payoff-chart__xlabel"
            textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
          >
            {v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </text>
        );
      })}

      {/* Payoff line */}
      <path d={linePath} className="payoff-chart__line" fill="none" />

      {/* Breakeven markers */}
      {group.breakevens.map((be, i) => (
        <g key={i}>
          <line x1={xScale(be)} y1={PAD.top} x2={xScale(be)} y2={H - PAD.bottom} className="payoff-chart__be-line" />
          <text x={xScale(be)} y={PAD.top + 10} className="payoff-chart__be-label" textAnchor="middle">
            BE {be.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </text>
        </g>
      ))}

      {/* Spot marker */}
      {spot && spot > 0 && spot >= minPrice && spot <= maxPrice && (
        <g>
          <line x1={xScale(spot)} y1={PAD.top} x2={xScale(spot)} y2={H - PAD.bottom} className="payoff-chart__spot-line" />
          <text x={xScale(spot)} y={H - PAD.bottom + 28} className="payoff-chart__spot-label" textAnchor="middle">
            Spot {spot.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </text>
        </g>
      )}
    </svg>
  );
};

const expiryLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

/**
 * PayoffModal — full-size payoff curve in a centered overlay.
 * Closes on backdrop click, the × button, or Esc.
 */
const PayoffModal: React.FC<{ group: RiskGroup; spot?: number; onClose: () => void }> = ({
  group,
  spot,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div className="payoff-modal__backdrop" onClick={onClose}>
      <div className="payoff-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="payoff-modal__header">
          <span className="payoff-modal__title">
            {group.underlying} <span className="risk-card__expiry">{expiryLabel(group.expiry)}</span>
            <span className="risk-card__legs">{group.legs.length} leg{group.legs.length > 1 ? 's' : ''}</span>
            {' '}Payoff at Expiry
          </span>
          <button className="payoff-modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="payoff-modal__summary">
          <span>Max Loss: <strong className="negative">{group.maxLoss == null ? 'Unlimited' : group.maxLoss >= 0 ? '—' : fmtInr(group.maxLoss)}</strong></span>
          <span>Max Profit: <strong className="positive">{group.maxProfit == null ? 'Unlimited' : group.maxProfit <= 0 ? '—' : fmtInr(group.maxProfit)}</strong></span>
          <span>Breakeven: <strong>{group.breakevens.length === 0 ? '—' : group.breakevens.map((b) => b.toLocaleString('en-IN')).join(' / ')}</strong></span>
          {spot && spot > 0 && <span>Spot: <strong>{spot.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></span>}
        </div>

        <div className="payoff-modal__chart">
          <PayoffChart group={group} spot={spot} />
        </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Position Risk Panel — per-strategy live P&L, max loss, breakeven(s),
 * and an invalidation-hit flag against journal stop-loss levels.
 * Clicking a card opens the payoff curve in a modal popup.
 */
const RiskPanel: React.FC<{ groups: RiskGroup[]; spotPrices: Map<string, number> }> = ({
  groups,
  spotPrices,
}) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const selected = groups.find((g) => g.key === selectedKey) || null;

  return (
    <div className="card risk-panel" style={{ marginBottom: 20 }}>
      <h3 className="card__title">Position Risk</h3>
      <div className="risk-panel__grid">
        {groups.map((g) => (
          <div
            key={g.key}
            className={`risk-card ${g.invalidationHit ? 'risk-card--invalidated' : ''}`}
            onClick={() => setSelectedKey(g.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(g.key); }
            }}
            title="Click to view payoff curve"
          >
            <div className="risk-card__header">
              <span className="risk-card__title">
                {g.underlying} <span className="risk-card__expiry">{expiryLabel(g.expiry)}</span>
                <span className="risk-card__legs">{g.legs.length} leg{g.legs.length > 1 ? 's' : ''}</span>
              </span>
              {g.invalidationHit && (
                <span className="risk-card__flag" title="A leg's stop-loss (invalidation) level has been hit">
                  ⚠ Invalidation hit
                </span>
              )}
              <span className="risk-card__chart-icon" aria-hidden="true">📈</span>
            </div>

            <div className="risk-card__metrics">
              <div className="risk-metric">
                <span className="risk-metric__label">Live P&L</span>
                <span
                  className={`risk-metric__value ${
                    g.livePnL == null ? '' : g.livePnL > 0 ? 'positive' : g.livePnL < 0 ? 'negative' : ''
                  }`}
                >
                  {g.livePnL == null ? '—' : fmtInr(g.livePnL)}
                </span>
              </div>

              <div className="risk-metric">
                <span className="risk-metric__label">Max Loss</span>
                <span className="risk-metric__value negative">
                  {g.maxLoss == null
                    ? 'Unlimited'
                    : g.maxLoss >= 0
                      ? '—'
                      : fmtInr(g.maxLoss)}
                </span>
              </div>

              <div className="risk-metric">
                <span className="risk-metric__label">Max Profit</span>
                <span className="risk-metric__value positive">
                  {g.maxProfit == null
                    ? 'Unlimited'
                    : g.maxProfit <= 0
                      ? '—'
                      : fmtInr(g.maxProfit)}
                </span>
              </div>

              <div className="risk-metric">
                <span className="risk-metric__label">Breakeven</span>
                <span className="risk-metric__value">
                  {g.breakevens.length === 0
                    ? '—'
                    : g.breakevens.map((b) => b.toLocaleString('en-IN')).join(' / ')}
                </span>
              </div>
            </div>

            {g.invalidationHit && (
              <div className="risk-card__breached">
                Breached:{' '}
                {g.legs
                  .filter((l) => l.invalidationHit)
                  .map((l) => `${l.position.strike}${l.position.optionType}`)
                  .join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      {selected && (
        <PayoffModal
          group={selected}
          spot={spotPrices.get(selected.underlying)}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
};

const PaperPositions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [spotPrices, setSpotPrices] = useState<Map<string, number>>(new Map());
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

  // Fetch underlying spot prices for the spot marker on the payoff chart.
  useEffect(() => {
    const openPositions = positions.filter((p) => !p.exited);
    if (openPositions.length === 0) return;

    const underlyings = [...new Set(openPositions.map((p) => underlyingFromSymbol(p.tradingsymbol)))];
    const keys = underlyings.map(spotQuoteKey);

    let cancelled = false;
    fetchQuotes(keys).then((quotes) => {
      if (cancelled) return;
      const map = new Map<string, number>();
      underlyings.forEach((u) => {
        const q = quotes.get(spotQuoteKey(u));
        if (q && q.last_price > 0) map.set(u, q.last_price);
      });
      setSpotPrices(map);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [positions]);

  const handleExit = async (id: string, instrumentToken: number) => {
    const exitPrice = livePrices.get(instrumentToken) || 0;
    await exitPosition(id, exitPrice);
    await loadPositions();
  };

  const riskGroups = computeRiskGroups(positions, livePrices);

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

      {/* Position Risk Panel */}
      <RiskPanel groups={riskGroups} spotPrices={spotPrices} />

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
                      <TradingViewLink symbol={pos.tradingsymbol} exchange="NFO" />
                      <span className="positions-table__strike">{pos.strike}</span>
                      <span className={`positions-table__type positions-table__type--${pos.optionType.toLowerCase()}`}>{pos.optionType}</span>
                      <span className="positions-table__expiry">{new Date(pos.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    </span>
                    {(pos.strategyTag || pos.confidence != null || pos.targetPrice != null || pos.stopLossPrice != null || pos.note) && (
                      <div className="positions-table__meta">
                        {pos.strategyTag && <span className="positions-table__tag">{pos.strategyTag}</span>}
                        {pos.confidence != null && <span>Conf {pos.confidence}%</span>}
                        {pos.targetPrice != null && <span>Tgt {pos.targetPrice.toFixed(2)}</span>}
                        {pos.stopLossPrice != null && <span>SL {pos.stopLossPrice.toFixed(2)}</span>}
                        {pos.note && <span className="positions-table__note">{pos.note}</span>}
                      </div>
                    )}
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
                      <TradingViewLink symbol={pos.tradingsymbol} exchange={pos.exchange} />
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
                      <TradingViewLink symbol={pos.tradingsymbol} exchange={pos.exchange} />
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

const Positions: React.FC<{ hideHeader?: boolean; initialMode?: PositionsMode }> = ({ hideHeader = false, initialMode }) => {
  const [mode, setMode] = useState<PositionsMode>(() =>
    initialMode || (localStorage.getItem('optiontrap_order_mode') as PositionsMode) || 'paper'
  );

  useEffect(() => {
    if (!initialMode) return;

    setMode(initialMode);
    localStorage.setItem('optiontrap_order_mode', initialMode);
  }, [initialMode]);

  const handleModeChange = (nextMode: PositionsMode) => {
    setMode(nextMode);
    localStorage.setItem('optiontrap_order_mode', nextMode);
  };

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
                <button key={m} className={`positions-mode-tab ${mode === m ? 'positions-mode-tab--active' : ''}`} onClick={() => handleModeChange(m)}>
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
            <button key={m} className={`positions-mode-tab ${mode === m ? 'positions-mode-tab--active' : ''}`} onClick={() => handleModeChange(m)}>
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
