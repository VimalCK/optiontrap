import React, { useState } from 'react';
import IconButton from '@/components/IconButton/IconButton';
import { ChevronDownIcon } from '@/components/icons/Icons';
import { formatSignedAmount } from '@/utils/formatAmount';
import { formatCalendarDate } from '@/utils/marketStatus';
import './DayGroupRow.css';

const dayLabel = (day: string) => formatCalendarDate(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

interface DayGroupRowProps {
  /** YYYY-MM-DD, IST. */
  day: string;
  count: number;
  /** What the rows are, singular: 'trade', 'position'. */
  noun: string;
  /** The day's P&L; null while there is none. */
  pnl: number | null;
  /** The table's columns before its P&L column, so the day's P&L lines up under it. */
  pnlColumn: number;
  /** The table's columns; the chevron takes the last. */
  columns: number;
  expanded: boolean;
  onToggle: () => void;
}

/** A table's heading row for one IST day: its date, row count and P&L, and a chevron that folds the day's rows away. */
const DayGroupRow: React.FC<DayGroupRowProps> = ({ day, count, noun, pnl, pnlColumn, columns, expanded, onToggle }) => {
  const plural = `${noun}s`;
  const tone = pnl == null ? '' : pnl >= 0 ? ' day-group-row__pnl--profit' : ' day-group-row__pnl--loss';
  const gap = columns - pnlColumn - 2;
  return (
    <tr className={`day-group-row${expanded ? '' : ' day-group-row--collapsed'}`} onClick={onToggle}>
      <th scope="colgroup" colSpan={pnlColumn}>
        {dayLabel(day)}
        <span className="day-group-row__count"> · {count} {count === 1 ? noun : plural}</span>
      </th>
      <td className={`day-group-row__pnl${tone}`}>{pnl == null ? '–' : formatSignedAmount(pnl)}</td>
      {gap > 0 && <td colSpan={gap} />}
      <td className="day-group-row__toggle" onClick={(e) => e.stopPropagation()}>
        <IconButton
          icon={<ChevronDownIcon />}
          label={expanded ? `Hide this day's ${plural}` : `Show this day's ${plural}`}
          expanded={expanded}
          onClick={onToggle}
          className="day-group-row__chevron"
        />
      </td>
    </tr>
  );
};

/** Which days of a grouped table are folded away; every day starts expanded. */
export function useDayGroups() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (day: string) => setCollapsed((days) => {
    const next = new Set(days);
    if (!next.delete(day)) next.add(day);
    return next;
  });
  return { isExpanded: (day: string) => !collapsed.has(day), toggle };
}

export default DayGroupRow;
