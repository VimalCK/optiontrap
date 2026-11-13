import React, { useRef, useState } from 'react';
import { samplePayoffCurve, type OiBar, type RiskGroup } from '@/services/positionRisk';
import { formatSignedAmount } from '@/utils/formatAmount';
import { compactNumber, niceTicks, payoffAt, payoffPaths, payoffRange, strikeNear } from './payoffGeometry';

const W = 900;
const H = 460;
const STRIKE_SNAP_PX = 10;
const SPOT_LABEL = { width: 184, height: 48 };
const TOOLTIP = { width: 250, height: 46 };

/** Expiry payoff curve for one risk group: P&L-at-expiry line split green/red, with breakeven markers. */
const PayoffChart: React.FC<{ group: RiskGroup; oiBars?: OiBar[]; spotPrice?: number | null }> = ({ group, oiBars, spotPrice }) => {
  const [hover, setHover] = useState<{ price: number; payoff: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const hasOi = !!oiBars && oiBars.length > 0;
  const PAD = { top: 28, right: hasOi ? 64 : 28, bottom: 44, left: 78 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const curve = samplePayoffCurve(group, spotPrice ?? undefined);
  const { points, minPrice, maxPrice } = curve;
  const { yMin, yMax } = payoffRange(curve.minPayoff, curve.maxPayoff);

  const xScale = (price: number) => PAD.left + ((price - minPrice) / (maxPrice - minPrice || 1)) * plotW;
  const yScale = (payoff: number) => PAD.top + (1 - (payoff - yMin) / (yMax - yMin || 1)) * plotH;
  const zeroY = yScale(0);

  // OI bars rise from the zero P&L line, scaled on their own axis (0 → the largest OI in view).
  const visibleOi = hasOi ? oiBars!.filter((b) => b.strike >= minPrice && b.strike <= maxPrice) : [];
  const maxOi = visibleOi.reduce((m, b) => Math.max(m, b.ceOi, b.peOi), 0);
  const oiSpan = Math.max(0, zeroY - PAD.top);
  const oiHeight = (oi: number) => (maxOi > 0 ? (oi / maxOi) * oiSpan : 0);
  const strikeGapPx = visibleOi.length > 1 ? Math.abs(xScale(visibleOi[1].strike) - xScale(visibleOi[0].strike)) : 24;
  const barW = Math.max(3, Math.min(10, strikeGapPx * 0.32));

  const { profit, loss } = payoffPaths(points, xScale, yScale);
  const strikes = [...new Set(group.legs.map((l) => l.position.strike))].sort((a, b) => a - b);

  const spotMarker = spotPrice != null && spotPrice > 0 && spotPrice >= minPrice && spotPrice <= maxPrice
    ? { price: spotPrice, payoff: payoffAt(points, spotPrice) }
    : null;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    if (mx < PAD.left || mx > W - PAD.right) { setHover(null); return; }

    const cursorPrice = Math.max(minPrice, Math.min(maxPrice, minPrice + ((mx - PAD.left) / (plotW || 1)) * (maxPrice - minPrice)));
    const price = strikeNear(mx, strikes, xScale, STRIKE_SNAP_PX) ?? cursorPrice;
    setHover({ price, payoff: payoffAt(points, price) });
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
        <pattern id={profitPatternId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(34, 197, 94, 0.14)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(34, 197, 94, 0.55)" strokeWidth="0.6" />
        </pattern>
        <pattern id={lossPatternId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(239, 68, 68, 0.14)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(239, 68, 68, 0.55)" strokeWidth="0.6" />
        </pattern>
      </defs>

      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} className="payoff-chart__zero" />

      {[yMax, yMax / 2, 0, yMin / 2, yMin].map((v, i) => (
        <text key={i} x={PAD.left - 8} y={yScale(v) + 3} className="payoff-chart__ylabel" textAnchor="end">
          {compactNumber(v)}
        </text>
      ))}

      <text className="payoff-chart__axis-title" textAnchor="middle" transform={`translate(16, ${PAD.top + plotH / 2}) rotate(-90)`}>
        Profit / Loss
      </text>

      {niceTicks(minPrice, maxPrice, 5).map((v, i, arr) => {
        const x = xScale(v);
        return (
          <g key={i}>
            <line x1={x} y1={H - PAD.bottom} x2={x} y2={H - PAD.bottom + 5} className="payoff-chart__tick" />
            <text x={x} y={H - 14} className="payoff-chart__xlabel" textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}>
              {v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </text>
          </g>
        );
      })}

      {/* PE bar on the left of each strike, CE bar on the right */}
      {visibleOi.map((b) => {
        const cx = xScale(b.strike);
        const ceH = oiHeight(b.ceOi);
        const peH = oiHeight(b.peOi);
        return (
          <g key={b.strike}>
            <rect x={cx - barW - 0.5} y={zeroY - peH} width={barW} height={peH} className="payoff-chart__oi-pe" />
            <rect x={cx + 0.5} y={zeroY - ceH} width={barW} height={ceH} className="payoff-chart__oi-ce" />
          </g>
        );
      })}

      {hasOi && maxOi > 0 && (
        <g>
          {[maxOi, maxOi / 2, 0].map((v, i) => (
            <text key={i} x={W - PAD.right + 8} y={zeroY - oiHeight(v) + 4} className="payoff-chart__oi-label" textAnchor="start">
              {v === 0 ? '0' : compactNumber(v)}
            </text>
          ))}
          <text className="payoff-chart__axis-title" textAnchor="middle" transform={`translate(${W - 14}, ${PAD.top + plotH / 2}) rotate(90)`}>
            Open Interest
          </text>
        </g>
      )}

      {loss.area && <path d={loss.area} fill={`url(#${lossPatternId})`} stroke="none" />}
      {profit.area && <path d={profit.area} fill={`url(#${profitPatternId})`} stroke="none" />}
      {loss.line && <path d={loss.line} className="payoff-chart__line-loss" fill="none" />}
      {profit.line && <path d={profit.line} className="payoff-chart__line-profit" fill="none" />}

      {spotMarker && (() => {
        const sx = xScale(spotMarker.price);
        const sy = yScale(spotMarker.payoff);
        const isProfit = spotMarker.payoff >= 0;
        const labelX = Math.max(PAD.left + 6, Math.min(sx + 10, W - PAD.right - SPOT_LABEL.width - 6));
        const labelY = Math.max(PAD.top + 6, Math.min(sy - SPOT_LABEL.height - 10, H - PAD.bottom - SPOT_LABEL.height - 6));
        return (
          <g className={`payoff-chart__spot payoff-chart__spot--${isProfit ? 'profit' : 'loss'}`}>
            <line x1={sx} y1={PAD.top} x2={sx} y2={H - PAD.bottom} className="payoff-chart__spot-line" />
            <circle cx={sx} cy={sy} r={5} className="payoff-chart__spot-dot" />
            <g>
              <rect x={labelX} y={labelY} width={SPOT_LABEL.width} height={SPOT_LABEL.height} rx={6} className="payoff-chart__spot-label-bg" />
              <text x={labelX + 10} y={labelY + 19} className="payoff-chart__spot-label">
                Spot {spotMarker.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </text>
              <text x={labelX + 10} y={labelY + 37} className="payoff-chart__spot-pnl">
                {isProfit ? 'Profit' : 'Loss'} {formatSignedAmount(spotMarker.payoff)}
              </text>
            </g>
          </g>
        );
      })()}

      {group.breakevens.map((be, i) => (
        <g key={i}>
          <line x1={xScale(be)} y1={PAD.top} x2={xScale(be)} y2={H - PAD.bottom} className="payoff-chart__be-line" />
          <text x={xScale(be)} y={PAD.top + 10} className="payoff-chart__be-label" textAnchor="middle">
            BE {be.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </text>
        </g>
      ))}

      {hover && (() => {
        const hx = xScale(hover.price);
        const hy = yScale(hover.payoff);
        const isProfit = hover.payoff >= 0;
        // Flip the tooltip to the left of the cursor near the right edge.
        const flip = hx + 14 + TOOLTIP.width > W - PAD.right;
        const tipX = flip ? hx - 14 - TOOLTIP.width : hx + 14;
        const tipY = Math.max(PAD.top, Math.min(hy - TOOLTIP.height / 2, H - PAD.bottom - TOOLTIP.height));
        return (
          <g className="payoff-chart__hover">
            <line x1={hx} y1={PAD.top} x2={hx} y2={H - PAD.bottom} className="payoff-chart__crosshair" />
            <circle cx={hx} cy={hy} r={4.5} className="payoff-chart__hover-dot" />
            <g>
              <rect x={tipX} y={tipY} width={TOOLTIP.width} height={TOOLTIP.height} rx={5} className="payoff-chart__tooltip-bg" />
              <text x={tipX + 10} y={tipY + 18} className="payoff-chart__tooltip-text">
                When Price is at {hover.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </text>
              <text x={tipX + 10} y={tipY + 35} className={`payoff-chart__tooltip-text payoff-chart__tooltip-pnl ${isProfit ? 'positive' : 'negative'}`}>
                Expected P&L on expiry: {hover.payoff >= 0 ? '+' : ''}{hover.payoff.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </text>
            </g>
          </g>
        );
      })()}
    </svg>
  );
};

export default PayoffChart;
