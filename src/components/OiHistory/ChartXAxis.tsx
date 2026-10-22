import React from 'react';

export interface ChartXAxisProps {
  dates: string[];
  padL: number;
  plotW: number;
  h: number;
}

/**
 * X-axis for the OI Price History chart: renders day-of-month numbers on top
 * and a colored month band with month-name labels underneath, so the axis
 * doesn't get crowded even when spanning many days across months.
 */
export const ChartXAxis: React.FC<ChartXAxisProps> = ({ dates, padL, plotW, h }) => {
  const n = dates.length;
  if (n === 0) return null;
  const stepX = plotW / n;
  const centerX = (i: number) => padL + (i + 0.5) * stepX;

  // Group contiguous dates by month (they arrive sorted ascending).
  const groups: { month: string; startIdx: number; endIdx: number }[] = [];
  dates.forEach((d, i) => {
    const month = d.slice(0, 7);
    const last = groups[groups.length - 1];
    if (!last || last.month !== month) groups.push({ month, startIdx: i, endIdx: i });
    else last.endIdx = i;
  });

  return (
    <g>
      {/* Day-of-month labels */}
      {dates.map((d, i) => (
        <text key={d} x={centerX(i)} y={h - 20} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">
          {d.slice(8)}
        </text>
      ))}

      {/* Month markers: small vertical ticks on the x-axis at the start and
          end of each month, plus the month name. No horizontal band, so it
          doesn't compete with the coloured expiry lines above. */}
      {groups.map((g) => {
        const startX = padL + g.startIdx * stepX;
        const endX = padL + (g.endIdx + 1) * stepX;
        const midX = (startX + endX) / 2;
        const [year, monthNum] = g.month.split('-').map(Number);
        const label = new Date(year, monthNum - 1, 1).toLocaleDateString('en-US', { month: 'short' });
        return (
          <g key={g.month}>
            <line
              x1={startX}
              x2={startX}
              y1={h - 30}
              y2={h - 24}
              stroke="var(--text-secondary)"
              strokeWidth="0.5"
              strokeLinecap="round"
              opacity={0.5}
            />
            <line
              x1={endX}
              x2={endX}
              y1={h - 30}
              y2={h - 24}
              stroke="var(--text-secondary)"
              strokeWidth="0.5"
              strokeLinecap="round"
              opacity={0.5}
            />
            <text
              x={midX}
              y={h - 8}
              textAnchor="middle"
              fontSize="5.5"
              fontWeight={700}
              fill="var(--text-secondary)"
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
};
