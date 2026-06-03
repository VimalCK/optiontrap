/**
 * PnLHeatmap
 * GitHub-style P&L heatmap. Stretches full width.
 * Months are grouped with a visible gap between them.
 * Green = profit, Red = loss, Gray = no trade.
 */

import React, { useMemo } from 'react';

interface PnLHeatmapProps {
  dailyPnL: Map<string, number>;
  endDate?: Date;
  months?: number;
}

interface DayCell {
  date: string;
  pnl: number | null;
  isToday: boolean;
  inRange: boolean;
}

/** A month group: label + array of week-columns (each column = 5 cells Mon–Fri) */
interface MonthGroup {
  label: string;
  weeks: (DayCell | null)[][];  // weeks[weekIdx][dayIdx 0=Mon..4=Fri]
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function toDateStr(d: Date): string {
  // Use local date to avoid UTC-shift issues
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function intensityLevel(pnl: number, maxAbs: number): number {
  if (maxAbs === 0) return 1;
  const ratio = Math.abs(pnl) / maxAbs;
  if (ratio < 0.2) return 1;
  if (ratio < 0.45) return 2;
  if (ratio < 0.7) return 3;
  return 4;
}

const PnLHeatmap: React.FC<PnLHeatmapProps> = ({ dailyPnL, endDate, months = 12 }) => {
  const today = useMemo(() => {
    const d = new Date(endDate ?? new Date());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [endDate]);

  const { monthGroups, totalPnL, winDays, lossDays, totalDays } = useMemo(() => {
    const todayStr = toDateStr(today);

    // Build month groups — one per calendar month in range
    const groups: MonthGroup[] = [];

    for (let mOffset = -(months - 1); mOffset <= 0; mOffset++) {
      const monthStart = new Date(today.getFullYear(), today.getMonth() + mOffset, 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + mOffset + 1, 0); // last day of month
      const label = MONTH_NAMES[monthStart.getMonth()];

      // Find the Monday on or before the 1st of this month
      let cursor = new Date(monthStart);
      const dow = cursor.getDay(); // 0=Sun
      const backTo = dow === 0 ? 6 : dow - 1;
      cursor.setDate(cursor.getDate() - backTo);

      const weeks: (DayCell | null)[][] = [];

      // Iterate weeks until we've passed the end of the month
      while (cursor <= monthEnd) {
        const week: (DayCell | null)[] = [];
        for (let di = 0; di < 5; di++) {
          // di 0=Mon,1=Tue...4=Fri  →  JS getDay() 1..5
          const dayDate = addDays(cursor, di);
          const dateStr = toDateStr(dayDate);
          const inMonth = dayDate.getMonth() === monthStart.getMonth();
          const inRange = dateStr <= todayStr && inMonth;

          if (!inMonth) {
            week.push(null); // outside this month — empty placeholder
          } else {
            week.push({
              date: dateStr,
              pnl: inRange ? (dailyPnL.get(dateStr) ?? null) : null,
              isToday: dateStr === todayStr,
              inRange,
            });
          }
        }
        weeks.push(week);
        cursor = addDays(cursor, 7);
      }

      groups.push({ label, weeks });
    }

    // Stats — only over the filtered dailyPnL passed in
    let total = 0, wins = 0, losses = 0, traded = 0;
    dailyPnL.forEach((pnl) => {
      total += pnl;
      traded++;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
    });

    return { monthGroups: groups, totalPnL: total, winDays: wins, lossDays: losses, totalDays: traded };
  }, [dailyPnL, today, months]);

  const maxAbs = useMemo(() => {
    let max = 0;
    dailyPnL.forEach((v) => { if (Math.abs(v) > max) max = Math.abs(v); });
    return max;
  }, [dailyPnL]);

  const [tooltip, setTooltip] = React.useState<{
    date: string; pnl: number; x: number; y: number;
  } | null>(null);

  const renderCell = (cell: DayCell | null, key: string) => {
    if (!cell) {
      return <div key={key} className="heatmap-cell heatmap-cell--empty heatmap-cell--filler" />;
    }

    let cls = 'heatmap-cell';
    if (!cell.inRange || cell.pnl === null) {
      cls += ' heatmap-cell--empty';
    } else if (cell.pnl > 0) {
      cls += ` heatmap-cell--profit heatmap-cell--profit-${intensityLevel(cell.pnl, maxAbs)}`;
    } else if (cell.pnl < 0) {
      cls += ` heatmap-cell--loss heatmap-cell--loss-${intensityLevel(cell.pnl, maxAbs)}`;
    } else {
      cls += ' heatmap-cell--zero';
    }
    if (cell.isToday) cls += ' heatmap-cell--today';

    return (
      <div
        key={key}
        className={cls}
        onMouseEnter={(e) => {
          if (!cell.inRange || cell.pnl === null) return;
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          setTooltip({ date: cell.date, pnl: cell.pnl, x: rect.left, y: rect.top });
        }}
        onMouseLeave={() => setTooltip(null)}
      />
    );
  };

  return (
    <div className="heatmap-wrapper">
      {/* Stats */}
      <div className="heatmap-stats">
        <div className="heatmap-stat">
          <span className="heatmap-stat__label">Total P&L</span>
          <span className={`heatmap-stat__value ${totalPnL > 0 ? 'heatmap-positive' : totalPnL < 0 ? 'heatmap-negative' : ''}`}>
            {totalPnL >= 0 ? '+' : ''}
            {totalPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="heatmap-stat">
          <span className="heatmap-stat__label">Trading Days</span>
          <span className="heatmap-stat__value">{totalDays}</span>
        </div>
        <div className="heatmap-stat">
          <span className="heatmap-stat__label">Win Days</span>
          <span className="heatmap-stat__value heatmap-positive">{winDays}</span>
        </div>
        <div className="heatmap-stat">
          <span className="heatmap-stat__label">Loss Days</span>
          <span className="heatmap-stat__value heatmap-negative">{lossDays}</span>
        </div>
        <div className="heatmap-stat">
          <span className="heatmap-stat__label">Win Rate</span>
          <span className="heatmap-stat__value">
            {totalDays > 0 ? ((winDays / totalDays) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>

      {/* Chart — full width, months as groups with gap */}
      <div className="heatmap-chart-outer">
        {/* Day labels column */}
        <div className="heatmap-day-col">
          <div className="heatmap-month-label-spacer" />
          {DAY_LABELS.map((d) => (
            <div key={d} className="heatmap-day-label">{d}</div>
          ))}
        </div>

        {/* Month groups */}
        <div className="heatmap-months-row">
          {monthGroups.map((group, gi) => (
            <div key={gi} className="heatmap-month-group">
              {/* Month name */}
              <div className="heatmap-month-name">{group.label}</div>
              {/* Rows: one per day of week */}
              {DAY_LABELS.map((_, dayIdx) => (
                <div key={dayIdx} className="heatmap-row">
                  {group.weeks.map((week, wi) =>
                    renderCell(week[dayIdx], `${gi}-${wi}-${dayIdx}`)
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span className="heatmap-legend__label">Less</span>
        <div className="heatmap-cell heatmap-cell--empty heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--profit heatmap-cell--profit-1 heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--profit heatmap-cell--profit-2 heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--profit heatmap-cell--profit-3 heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--profit heatmap-cell--profit-4 heatmap-legend__cell" />
        <span className="heatmap-legend__sep">·</span>
        <div className="heatmap-cell heatmap-cell--loss heatmap-cell--loss-1 heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--loss heatmap-cell--loss-2 heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--loss heatmap-cell--loss-3 heatmap-legend__cell" />
        <div className="heatmap-cell heatmap-cell--loss heatmap-cell--loss-4 heatmap-legend__cell" />
        <span className="heatmap-legend__label">More</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="heatmap-tooltip" style={{ top: tooltip.y - 56, left: tooltip.x + 8 }}>
          <span className="heatmap-tooltip__date">{tooltip.date}</span>
          <span className={`heatmap-tooltip__pnl ${tooltip.pnl > 0 ? 'heatmap-positive' : 'heatmap-negative'}`}>
            {tooltip.pnl >= 0 ? '+' : ''}
            {tooltip.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  );
};

export default PnLHeatmap;
