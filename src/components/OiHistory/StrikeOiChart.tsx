import React from 'react';
import type { StrikeHistoryEntry } from './types';
import { formatOiCompact } from './helpers';
import { ChartXAxis } from './ChartXAxis';

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
}

/** OI (or volume) bars per expiry with price lines, for one option type of the selected strike. */
export const StrikeOiChart: React.FC<StrikeOiChartProps> = ({ optionType, dates, dateMap, maxOi, maxPrice, expiries, expiryColors, showVolume }) => {
  const oiKey = optionType === 'CE' ? 'ceOi' : 'peOi';
  const closeKey = optionType === 'CE' ? 'ceClose' : 'peClose';
  const volumeKey = optionType === 'CE' ? 'ceVolume' : 'peVolume';
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

  // Build price lines per expiry
  const priceLines = expiries.map((exp) => {
    const pts: { x: number; y: number; price: number; date: string }[] = [];
    dates.forEach((d, i) => {
      const x = PAD_L + (i + 0.5) * (plotW / n);
      const entry = dateMap.get(d)?.get(exp);
      if (entry && entry[closeKey] > 0) {
        const y = PAD_T + plotH - (entry[closeKey] / safeMaxPrice) * plotH;
        pts.push({ x, y, price: entry[closeKey], date: d });
      }
    });
    return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
  }).filter((l) => l.pts.length > 0);

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

        {/* OI bars (stacked per expiry) */}
        {dates.map((d, i) => {
          const x = PAD_L + (i + 0.5) * (plotW / n);
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
          const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;
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

        {/* Right axis labels (OI) */}
        {[0, 0.5, 1].map((frac) => (
          <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
            {formatOiCompact(Math.round(maxBarValue * frac))}
          </text>
        ))}

        {/* X-axis: day numbers + month band */}
        <ChartXAxis dates={dates} padL={PAD_L} plotW={plotW} h={H} />
      </svg>
    </div>
  );
};
