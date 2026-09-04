import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getPositions, exitPosition, Position } from '@/services/positions';

import { fetchQuotes, fetchPositions, KitePosition, KitePositions } from '@/services/kiteApi';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import { isMarketLive } from '@/utils/marketStatus';
import {
  computeRiskGroups,
  samplePayoffCurve,
  loadGroupOi,
  RiskGroup,
  OiBar,
} from '@/services/positionRisk';
import '@/styles/positions.css';

const fmtInr = (n: number) =>
  `${n >= 0 ? '+' : ''}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type PositionsMode = 'paper' | 'live';

/**
 * Generate rounded ("nice") axis tick values covering [min, max].
 * Picks a step from the 1/2/5 × 10ⁿ family so labels land on clean numbers
 * (e.g. 620, 640, 660 rather than 621, 643, 665).
 */
function niceTicks(min: number, max: number, targetCount: number): number[] {
  const span = max - min;
  if (span <= 0) return [Math.round(min)];

  const rawStep = span / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;

  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/**
 * PayoffChart — an SVG expiry payoff curve for a single risk group.
 * Renders the P&L-at-expiry line (split green/red), a zero axis, and
 * breakeven markers.
 */
const PayoffChart: React.FC<{ group: RiskGroup; oiBars?: OiBar[] }> = ({ group, oiBars }) => {
  const W = 900;
  const H = 460;
  const hasOi = !!oiBars && oiBars.length > 0;
  // Extra right padding for the secondary OI axis when OI bars are shown.
  const PAD = { top: 28, right: hasOi ? 64 : 28, bottom: 44, left: 78 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const curve = samplePayoffCurve(group);
  const { points, minPrice, maxPrice } = curve;

  // Symmetric payoff domain so the zero P&L line sits exactly at the vertical
  // center: bound both sides by the larger of |max profit| and |max loss|.
  const rawMin = Math.min(curve.minPayoff, 0);
  const rawMax = Math.max(curve.maxPayoff, 0);
  const bound = Math.max(Math.abs(rawMin), Math.abs(rawMax)) || 1;
  const yPad = bound * 0.1;
  const yMax = bound + yPad;
  const yMin = -(bound + yPad);

  const xScale = (price: number) =>
    PAD.left + ((price - minPrice) / (maxPrice - minPrice || 1)) * plotW;
  const yScale = (payoff: number) =>
    PAD.top + (1 - (payoff - yMin) / (yMax - yMin || 1)) * plotH;

  const zeroY = yScale(0);

  // OI bars: filter to strikes within the visible price range, then scale their
  // height off a secondary axis (0 → maxOi). Bars hang down from the zero P&L
  // center line toward the plot bottom.
  const visibleOi = hasOi
    ? oiBars!.filter((b) => b.strike >= minPrice && b.strike <= maxPrice)
    : [];
  const maxOi = visibleOi.reduce((m, b) => Math.max(m, b.ceOi, b.peOi), 0);
  // Available vertical space from the center line up to the top of the plot.
  const oiSpan = Math.max(0, zeroY - PAD.top);
  const oiHeight = (oi: number) =>
    maxOi > 0 ? (oi / maxOi) * oiSpan : 0;
  // Bar half-width based on strike spacing (fallback to a fixed width).
  const strikeGapPx = visibleOi.length > 1
    ? Math.abs(xScale(visibleOi[1].strike) - xScale(visibleOi[0].strike))
    : 24;
  const barW = Math.max(3, Math.min(10, strikeGapPx * 0.32));

  // Build the payoff line as {x, y, payoff} vertices, inserting extra vertices
  // exactly at each zero-crossing so profit (green) and loss (red) segments can
  // be split cleanly at the P&L = 0 axis.
  type V = { x: number; y: number; payoff: number };
  const verts: V[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      // Zero-crossing between prev and current → insert the crossing point.
      if ((prev.payoff < 0 && p.payoff > 0) || (prev.payoff > 0 && p.payoff < 0)) {
        const t = prev.payoff / (prev.payoff - p.payoff);
        const crossPrice = prev.price + t * (p.price - prev.price);
        verts.push({ x: xScale(crossPrice), y: zeroY, payoff: 0 });
      }
    }
    verts.push({ x: xScale(p.price), y: yScale(p.payoff), payoff: p.payoff });
  }

  // Produce line + filled-area path strings for one side of the zero axis.
  // A "run" is a maximal sequence of vertices on that side; each run yields a
  // line polyline and a closed area down/up to the zero axis.
  const buildSide = (sign: 1 | -1): { line: string; area: string } => {
    const inSide = (v: V) => (sign > 0 ? v.payoff >= 0 : v.payoff <= 0);
    let line = '';
    let area = '';
    let run: V[] = [];

    const flush = () => {
      if (run.length < 2) { run = []; return; }
      line += 'M ' + run.map((v) => `${v.x.toFixed(1)} ${v.y.toFixed(1)}`).join(' L ') + ' ';
      const first = run[0];
      const last = run[run.length - 1];
      area += `M ${first.x.toFixed(1)} ${zeroY.toFixed(1)} `
        + run.map((v) => `L ${v.x.toFixed(1)} ${v.y.toFixed(1)}`).join(' ')
        + ` L ${last.x.toFixed(1)} ${zeroY.toFixed(1)} Z `;
      run = [];
    };

    for (const v of verts) {
      if (inSide(v)) run.push(v);
      else flush();
    }
    flush();
    return { line, area };
  };

  const green = buildSide(1);
  const red = buildSide(-1);

  const fmtK = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 100000) return `${(n / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return n.toFixed(0);
  };

  // ── Hover interaction ────────────────────────────────────────────────
  const strikes = [...new Set(group.legs.map((l) => l.position.strike))].sort((a, b) => a - b);

  // Exact payoff at an arbitrary price via linear interpolation between the
  // sampled curve points (kinks are sampled, so interpolation is exact).
  const payoffAt = (price: number): number => {
    const pts = points;
    if (pts.length === 0) return 0;
    if (price <= pts[0].price) return pts[0].payoff;
    if (price >= pts[pts.length - 1].price) return pts[pts.length - 1].payoff;
    for (let i = 1; i < pts.length; i++) {
      if (price <= pts[i].price) {
        const a = pts[i - 1];
        const b = pts[i];
        const t = b.price === a.price ? 0 : (price - a.price) / (b.price - a.price);
        return a.payoff + t * (b.payoff - a.payoff);
      }
    }
    return pts[pts.length - 1].payoff;
  };

  const [hover, setHover] = useState<{ price: number; payoff: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    // Client px → SVG viewBox coords.
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    if (mx < PAD.left || mx > W - PAD.right) { setHover(null); return; }

    let price = minPrice + ((mx - PAD.left) / (plotW || 1)) * (maxPrice - minPrice);
    price = Math.max(minPrice, Math.min(maxPrice, price));

    // Soft-snap to a nearby strike (within ~10px).
    const SNAP_PX = 10;
    let bestStrike: number | null = null;
    let bestDist = SNAP_PX;
    for (const s of strikes) {
      const d = Math.abs(xScale(s) - mx);
      if (d <= bestDist) { bestDist = d; bestStrike = s; }
    }
    if (bestStrike != null) price = bestStrike;

    setHover({ price, payoff: payoffAt(price) });
  };

  // Unique pattern ids per chart instance (avoids SVG defs collisions).
  const profitPatternId = `hatch-profit-${group.key}`;
  const lossPatternId = `hatch-loss-${group.key}`;

  return (
    <svg
      ref={svgRef}
      className="payoff-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Payoff curve"
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        {/* Diagonal hairline hatch over a translucent fill (same slope both sides) */}
        <pattern id={profitPatternId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(34, 197, 94, 0.14)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(34, 197, 94, 0.55)" strokeWidth="0.6" />
        </pattern>
        <pattern id={lossPatternId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(239, 68, 68, 0.14)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(239, 68, 68, 0.55)" strokeWidth="0.6" />
        </pattern>
      </defs>

      {/* Zero P&L axis */}
      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} className="payoff-chart__zero" />

      {/* Y axis labels: max, mid, 0, -mid, -max (symmetric) */}
      {[yMax, yMax / 2, 0, yMin / 2, yMin].map((v, i) => (
        <text key={i} x={PAD.left - 8} y={yScale(v) + 3} className="payoff-chart__ylabel" textAnchor="end">
          {fmtK(v)}
        </text>
      ))}

      {/* Left vertical axis title */}
      <text
        className="payoff-chart__axis-title"
        textAnchor="middle"
        transform={`translate(16, ${PAD.top + plotH / 2}) rotate(-90)`}
      >
        Profit / Loss
      </text>

      {/* X axis labels + ticks at rounded ("nice") price values */}
      {niceTicks(minPrice, maxPrice, 5).map((v, i, arr) => {
        const x = xScale(v);
        return (
          <g key={i}>
            <line x1={x} y1={H - PAD.bottom} x2={x} y2={H - PAD.bottom + 5} className="payoff-chart__tick" />
            <text
              x={x}
              y={H - 14}
              className="payoff-chart__xlabel"
              textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
            >
              {v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </text>
          </g>
        );
      })}

      {/* OI bars (behind the payoff curve) — CE and PE per strike, rising
          up from the zero P&L center line */}
      {hasOi && visibleOi.map((b) => {
        const cx = xScale(b.strike);
        const ceH = oiHeight(b.ceOi);
        const peH = oiHeight(b.peOi);
        return (
          <g key={b.strike}>
            {/* PE bar on the left of the strike, CE bar on the right */}
            <rect
              x={cx - barW - 0.5}
              y={zeroY - peH}
              width={barW}
              height={peH}
              className="payoff-chart__oi-pe"
            />
            <rect
              x={cx + 0.5}
              y={zeroY - ceH}
              width={barW}
              height={ceH}
              className="payoff-chart__oi-ce"
            />
          </g>
        );
      })}

      {/* Secondary OI axis (right): 0 at the center line, max at the top */}
      {hasOi && maxOi > 0 && (
        <g>
          {[maxOi, maxOi / 2, 0].map((v, i) => (
            <text
              key={i}
              x={W - PAD.right + 8}
              y={zeroY - oiHeight(v) + 4}
              className="payoff-chart__oi-label"
              textAnchor="start"
            >
              {v === 0 ? '0' : fmtK(v)}
            </text>
          ))}
          {/* Right vertical axis title — centered over the full plot height */}
          <text
            className="payoff-chart__axis-title"
            textAnchor="middle"
            transform={`translate(${W - 14}, ${PAD.top + plotH / 2}) rotate(90)`}
          >
            Open Interest
          </text>
        </g>
      )}

      {/* Filled areas — translucent fill overlaid with diagonal hatch hairlines */}
      {red.area && <path d={red.area} fill={`url(#${lossPatternId})`} stroke="none" />}
      {green.area && <path d={green.area} fill={`url(#${profitPatternId})`} stroke="none" />}

      {/* Payoff line, split into profit (green) and loss (red) */}
      {red.line && <path d={red.line} className="payoff-chart__line-loss" fill="none" />}
      {green.line && <path d={green.line} className="payoff-chart__line-profit" fill="none" />}

      {/* Breakeven markers */}
      {group.breakevens.map((be, i) => (
        <g key={i}>
          <line x1={xScale(be)} y1={PAD.top} x2={xScale(be)} y2={H - PAD.bottom} className="payoff-chart__be-line" />
          <text x={xScale(be)} y={PAD.top + 10} className="payoff-chart__be-label" textAnchor="middle">
            BE {be.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </text>
        </g>
      ))}

      {/* Hover crosshair + dot + tooltip */}
      {hover && (() => {
        const hx = xScale(hover.price);
        const hy = yScale(hover.payoff);
        const isProfit = hover.payoff >= 0;
        const priceStr = `When Price is at ${hover.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        const pnlStr = `Expected P&L on expiry: ${hover.payoff >= 0 ? '+' : ''}${hover.payoff.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        const tipW = 250;
        const tipH = 46;
        // Flip the tooltip to the left of the cursor near the right edge.
        const flip = hx + 14 + tipW > W - PAD.right;
        const tipX = flip ? hx - 14 - tipW : hx + 14;
        const tipY = Math.max(PAD.top, Math.min(hy - tipH / 2, H - PAD.bottom - tipH));
        return (
          <g className="payoff-chart__hover">
            <line x1={hx} y1={PAD.top} x2={hx} y2={H - PAD.bottom} className="payoff-chart__crosshair" />
            <circle cx={hx} cy={hy} r={4.5} className="payoff-chart__hover-dot" />
            <g>
              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={5} className="payoff-chart__tooltip-bg" />
              <text x={tipX + 10} y={tipY + 18} className="payoff-chart__tooltip-text">
                {priceStr}
              </text>
              <text
                x={tipX + 10}
                y={tipY + 35}
                className={`payoff-chart__tooltip-text payoff-chart__tooltip-pnl ${isProfit ? 'positive' : 'negative'}`}
              >
                {pnlStr}
              </text>
            </g>
          </g>
        );
      })()}

    </svg>
  );
};

const expiryLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

/**
 * PayoffModal — full-size payoff curve in a centered overlay.
 * Closes on backdrop click, the × button, or Esc.
 */
const PayoffModal: React.FC<{ group: RiskGroup; onClose: () => void }> = ({
  group,
  onClose,
}) => {
  const [oiBars, setOiBars] = useState<OiBar[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    loadGroupOi(group).then((bars) => { if (!cancelled) setOiBars(bars); });
    return () => { cancelled = true; };
  }, [group]);

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
        </div>

        <div className="payoff-modal__chart">
          <PayoffChart group={group} oiBars={oiBars} />
        </div>
        {oiBars.length > 0 && (
          <div className="payoff-modal__legend">
            <span className="payoff-modal__legend-item"><span className="swatch swatch--ce" /> Call OI</span>
            <span className="payoff-modal__legend-item"><span className="swatch swatch--pe" /> Put OI</span>
          </div>
        )}
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
const RiskPanel: React.FC<{ groups: RiskGroup[] }> = ({ groups }) => {
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
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
};

const PaperPositions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadPositions = useCallback(async () => {
    // Server already excludes positions exited before today (IST).
    const pos = await getPositions();
    setPositions(pos);
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
      <RiskPanel groups={riskGroups} />

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
