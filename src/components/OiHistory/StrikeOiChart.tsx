import React from 'react';
import type { StrikeHistoryEntry } from './types';
import { formatOiCompact } from './helpers';
import { ChartXAxis } from './ChartXAxis';
import { FAIR_LINE_COLOR, richnessColor } from '@/services/fairValue';

/** Rich / cheap gaps at or below this share of fair value are not drawn. */
const MIN_RICH_PCT = 0.05;

interface StrikeOiChartProps {
  optionType: 'CE' | 'PE';
  dates: string[];
  dateMap: Map<string, Map<string, StrikeHistoryEntry>>;
  /** Highest CE or PE OI across both charts, so their bars share a scale. */
  maxOi: number;
  maxPrice: number;
  expiries: string[];
  expiryColors: Map<string, string>;
  showVolume: boolean;
  /** Draw the fair-value line and rich / cheap bars (meant for a single expiry). */
  showFair?: boolean;
}

/** OI (or volume) bars per expiry with price lines, for one option type of the selected strike. */
export const StrikeOiChart: React.FC<StrikeOiChartProps> = ({ optionType, dates, dateMap, maxOi, maxPrice, expiries, expiryColors, showVolume, showFair = false }) => {
  const oiKey = optionType === 'CE' ? 'ceOi' : 'peOi';
  const closeKey = optionType === 'CE' ? 'ceClose' : 'peClose';
  const volumeKey = optionType === 'CE' ? 'ceVolume' : 'peVolume';
  const fairKey = optionType === 'CE' ? 'ceFair' : 'peFair';
  const richKey = optionType === 'CE' ? 'ceRichPct' : 'peRichPct';
  const W = 700, H = 162, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxBarValue = showVolume
    ? Math.max(1, ...dates.flatMap((date) => expiries.map((exp) => dateMap.get(date)?.get(exp)?.[volumeKey] || 0)))
    : maxOi;
  const n = dates.length;
  if (n === 0 || maxOi === 0) return null;
  const expiryCount = Math.max(1, expiries.length);
  const slotW = plotW / n;
  const barW = Math.min((slotW * 0.8) / expiryCount, 10);
  const safeMaxPrice = maxPrice || 1;
  const xAt = (i: number) => PAD_L + (i + 0.5) * (plotW / n);
  const yAt = (price: number) => PAD_T + plotH - (price / safeMaxPrice) * plotH;

  // Build price lines per expiry
  const priceLines = expiries.map((exp) => {
    const pts: { x: number; y: number; price: number; date: string }[] = [];
    dates.forEach((d, i) => {
      const entry = dateMap.get(d)?.get(exp);
      if (entry && entry[closeKey] > 0) {
        pts.push({ x: xAt(i), y: yAt(entry[closeKey]), price: entry[closeKey], date: d });
      }
    });
    return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
  }).filter((l) => l.pts.length > 0);

  // Fair-value line per expiry
  const fairLines = showFair ? expiries.map((exp) => {
    const pts: { x: number; y: number; priceY: number | null; pct: number | null }[] = [];
    dates.forEach((d, i) => {
      const entry = dateMap.get(d)?.get(exp);
      const fair = entry?.[fairKey];
      if (!entry || fair == null || !(fair > 0)) return;
      pts.push({ x: xAt(i), y: yAt(fair), priceY: entry[closeKey] > 0 ? yAt(entry[closeKey]) : null, pct: entry[richKey] ?? null });
    });
    return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
  }).filter((l) => l.pts.length > 0) : [];

  // In the fair-value view the bars show the rich / cheap gap instead of OI or volume; small gaps are left out.
  const richPoints = fairLines
    .flatMap((l) => l.pts)
    .filter((p): p is typeof p & { pct: number } => p.pct !== null && Math.abs(p.pct) > MIN_RICH_PCT)
    .map((p) => ({ ...p, color: richnessColor(p.pct > 0 ? 'Expensive' : 'Cheap') }));
  const maxRichPct = Math.max(0.1, ...richPoints.map((p) => Math.abs(p.pct)));

  // Grey shading between the price line and the fair-value line
  const gapAreas = fairLines.flatMap(({ exp, pts }) => {
    const paired = pts.filter((p): p is typeof p & { priceY: number } => p.priceY !== null);
    if (paired.length < 2) return [];
    const outline = [...paired.map((p) => `${p.x},${p.priceY}`), ...[...paired].reverse().map((p) => `${p.x},${p.y}`)];
    return [{ key: exp, points: outline.join(' ') }];
  });

  return (
    <div className="oi-history__chart-panel">
      <div className={`oi-history__chart-label${optionType === 'PE' ? ' oi-history__chart-label--pe' : ''}`}>{optionType}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="oi-history__chart-svg">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line key={frac} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - frac)} y2={PAD_T + plotH * (1 - frac)} stroke="var(--card-border)" strokeWidth="0.5" />
        ))}
        {/* X-axis baseline */}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />

        {/* Rich / cheap bars: height is the size of the gap, amber expensive, blue cheap */}
        {showFair && richPoints.map((p, k) => {
          const barH = Math.max((Math.abs(p.pct) / maxRichPct) * plotH, 0.5);
          const bw = Math.min(slotW * 0.5, 10);
          return (
            <g key={`rich-${k}`}>
              <rect x={p.x - bw / 2} y={PAD_T + plotH - barH} width={bw} height={barH} fill={p.color} opacity={0.3} rx={1} />
              <text x={p.x} y={PAD_T + plotH - barH - 2} textAnchor="middle" fontSize="4.5" fontWeight="600" fill={p.color}>
                {p.pct > 0 ? '+' : ''}{(p.pct * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* OI bars (stacked per expiry) */}
        {!showFair && dates.map((d, i) => {
          const x = xAt(i);
          const expiryBars = expiries
            .map((exp) => ({ exp, value: showVolume ? dateMap.get(d)?.get(exp)?.[volumeKey] || 0 : dateMap.get(d)?.get(exp)?.[oiKey] || 0 }))
            .filter((b) => b.value > 0);
          const totalBarW = barW * expiryBars.length;
          return expiryBars.map((b, j) => {
            const barH = (b.value / maxBarValue) * plotH;
            const bx = x - totalBarW / 2 + j * barW;
            return (
              <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={Math.max(barW * 0.85, 0.5)} height={barH}
                fill={expiryColors.get(b.exp)} opacity={0.25} rx={1} />
            );
          });
        })}

        {gapAreas.map((a) => (
          <polygon key={`gap-${a.key}`} points={a.points} fill={FAIR_LINE_COLOR} opacity={0.18} stroke="none" />
        ))}

        {/* Fair-value line, under the price line */}
        {fairLines.map(({ exp, pts, points }) => (
          <g key={`fair-${exp}`}>
            <polyline points={points} fill="none" stroke={FAIR_LINE_COLOR} strokeWidth="1" opacity="0.9" />
            {pts.map((p, k) => (
              <circle key={`dot-${k}`} cx={p.x} cy={p.y} r={1.2} fill="var(--card-bg-solid)" stroke={FAIR_LINE_COLOR} strokeWidth="0.6" />
            ))}
          </g>
        ))}

        {/* Price lines + data points with price labels */}
        {priceLines.map(({ exp, points, pts }) => (
          <g key={exp}>
            <polyline points={points} fill="none" stroke={expiryColors.get(exp)} strokeWidth="1.2" strokeLinejoin="round" />
            {pts.map((p, k) => (
              <g key={k}>
                <circle cx={p.x} cy={p.y} r={1.5} fill={expiryColors.get(exp)} />
                <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="4" fill={expiryColors.get(exp)}>
                  ₹{p.price < 10 ? p.price.toFixed(1) : Math.round(p.price)}
                </text>
              </g>
            ))}
          </g>
        ))}

        {/* Average price line */}
        {(() => {
          const allPrices = priceLines.flatMap((l) => l.pts.map((p) => p.price));
          if (allPrices.length === 0) return null;
          const avg = allPrices.reduce((s, v) => s + v, 0) / allPrices.length;
          const avgY = yAt(avg);
          return (
            <g>
              <line x1={PAD_L} y1={avgY} x2={W - PAD_R} y2={avgY} stroke="var(--text-secondary)" strokeWidth="0.5" strokeDasharray="3,2" opacity="0.6" />
              <text x={PAD_L - 4} y={avgY + 2} textAnchor="end" fontSize="5" fill="var(--text-secondary)" opacity="0.7">avg</text>
            </g>
          );
        })()}

        {/* Left axis labels (price) */}
        {[0, 0.5, 1].map((frac) => (
          <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
            ₹{Math.round(safeMaxPrice * frac)}
          </text>
        ))}

        {/* Right axis labels (OI, volume, or the rich / cheap % in the fair-value view) */}
        {[0, 0.5, 1].map((frac) => (
          <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
            {showFair ? `${Math.round(maxRichPct * frac * 100)}%` : formatOiCompact(Math.round(maxBarValue * frac))}
          </text>
        ))}

        {/* X-axis: day numbers + month band */}
        <ChartXAxis dates={dates} padL={PAD_L} plotW={plotW} h={H} />
      </svg>
    </div>
  );
};
