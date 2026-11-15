import React, { useMemo } from 'react';
import { formatNumericDate } from '@/utils/marketStatus';
import { formatAmount, formatSignedAmount } from '@/utils/formatAmount';
import type { JournalTotals } from '@/services/tradeJournal';
import { ShimmerText } from '@/components/Shimmer/Shimmer';
import { createPortal } from 'react-dom';

interface PnLHeatmapProps {
  dailyPnL: Map<string, number>;
  /** The range's P&L before charges, its charges, and the realised P&L, for the summary strip. */
  totals: JournalTotals;
  endDate?: Date;
  /** The stats shimmer while the range's report loads; the calendar shows empty meanwhile. */
  loading?: boolean;
}

interface DayCell {
  date: string;
  pnl: number | null;
  isToday: boolean;
  inRange: boolean;
}

/** A month group: label + array of week-columns (each column = one cell per shown weekday) */
interface MonthGroup {
  label: string;
  weeks: (DayCell | null)[][];  // weeks[weekIdx][dayIdx 0=Mon..4=Fri, 5=Sat, 6=Sun]
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Every day gets a row, weekends included: trades can close on a Saturday or
// Sunday, and the calendar keeps the same shape whatever the data.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

const toneClass = (value: number) => (value > 0 ? 'heatmap-positive' : value < 0 ? 'heatmap-negative' : '');

function intensityLevel(pnl: number, maxAbs: number): number {
  if (maxAbs === 0) return 1;
  const ratio = Math.abs(pnl) / maxAbs;
  if (ratio < 0.2) return 1;
  if (ratio < 0.45) return 2;
  if (ratio < 0.7) return 3;
  return 4;
}

const PnLHeatmap: React.FC<PnLHeatmapProps> = ({ dailyPnL, totals, endDate, loading = false }) => {
  const today = useMemo(() => {
    const d = new Date(endDate ?? new Date());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [endDate]);

  const { monthGroups, winDays, lossDays, totalDays } = useMemo(() => {
    const todayStr = toDateStr(today);

    const startYear = today.getFullYear();

    const groups: MonthGroup[] = [];

    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(startYear, m, 1);
      const monthEnd = new Date(startYear, m + 1, 0);
      const label = MONTH_NAMES[m];

      let cursor = new Date(monthStart);
      const dow = cursor.getDay(); // 0=Sun
      const backTo = dow === 0 ? 6 : dow - 1;
      cursor.setDate(cursor.getDate() - backTo);

      const weeks: (DayCell | null)[][] = [];

      while (cursor <= monthEnd) {
        const week: (DayCell | null)[] = [];
        for (let di = 0; di < DAY_LABELS.length; di++) {
          // di 0=Mon … 6=Sun
          const dayDate = addDays(cursor, di);
          const dateStr = toDateStr(dayDate);
          const inMonth = dayDate.getMonth() === monthStart.getMonth();
          const inRange = dateStr <= todayStr && inMonth;

          if (!inMonth) {
            week.push(null);
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

    // Only over the filtered dailyPnL passed in.
    let wins = 0, losses = 0, traded = 0;
    dailyPnL.forEach((pnl) => {
      traded++;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
    });

    return { monthGroups: groups, winDays: wins, lossDays: losses, totalDays: traded };
  }, [dailyPnL, today]);

  const maxAbs = useMemo(() => {
    let max = 0;
    dailyPnL.forEach((v) => { if (Math.abs(v) > max) max = Math.abs(v); });
    return max;
  }, [dailyPnL]);

  const [tooltip, setTooltip] = React.useState<{
    date: string; pnl: number | null; x: number; y: number;
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
    if (cell.inRange) cls += ' heatmap-cell--hoverable';

    return (
      <div
        key={key}
        className={cls}
        onMouseEnter={(e) => {
          if (!cell.inRange) return;
          setTooltip({ date: cell.date, pnl: cell.pnl, x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => {
          if (!cell.inRange) return;
          setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : { date: cell.date, pnl: cell.pnl, x: e.clientX, y: e.clientY });
        }}
        onMouseLeave={() => setTooltip(null)}
      />
    );
  };

  return (
    <div className="heatmap-wrapper">
      <div className="heatmap-stats">
        {[
          { label: 'Total P&L', title: 'Before charges', value: formatSignedAmount(totals.pnl), tone: toneClass(totals.pnl) },
          { label: 'Charges', title: 'What Zerodha would charge for the entries and exits', value: formatAmount(totals.charges), tone: '' },
          { label: 'Realised P&L', title: 'Total P&L minus charges', value: formatSignedAmount(totals.realised), tone: toneClass(totals.realised) },
          { label: 'Trading Days', value: String(totalDays), tone: '' },
          { label: 'Win Days', value: String(winDays), tone: 'heatmap-positive' },
          { label: 'Loss Days', value: String(lossDays), tone: 'heatmap-negative' },
          { label: 'Win Rate', value: `${totalDays > 0 ? ((winDays / totalDays) * 100).toFixed(1) : '0.0'}%`, tone: '' },
        ].map((stat) => (
          <div key={stat.label} className="heatmap-stat">
            <span className="heatmap-stat__label" title={stat.title}>{stat.label}</span>
            <span className={`heatmap-stat__value ${stat.tone}`}><ShimmerText loading={loading} width="4em">{stat.value}</ShimmerText></span>
          </div>
        ))}
      </div>

      <div className="heatmap-chart-outer">
        <div className="heatmap-day-col">
          <div className="heatmap-month-label-spacer" />
          {DAY_LABELS.map((d) => (
            <div key={d} className="heatmap-day-label">{d}</div>
          ))}
        </div>

        <div className="heatmap-months-row">
          {monthGroups.map((group, gi) => (
            <div key={gi} className="heatmap-month-group">
              <div className="heatmap-month-name">{group.label}</div>
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

      {/* Tooltip — rendered in a portal to escape overflow:hidden parents */}
      {tooltip && createPortal(
        <div
          className="heatmap-tooltip"
          style={{
            position: 'fixed',
            top: tooltip.y - 64,
            left: tooltip.x + 16,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <span className="heatmap-tooltip__date">{formatNumericDate(tooltip.date)}</span>
          {tooltip.pnl !== null ? (
            <span className={`heatmap-tooltip__pnl ${tooltip.pnl > 0 ? 'heatmap-positive' : tooltip.pnl < 0 ? 'heatmap-negative' : ''}`}>
              {tooltip.pnl >= 0 ? '+' : ''}
              {tooltip.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className="heatmap-tooltip__no-trade">No trades</span>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default PnLHeatmap;
