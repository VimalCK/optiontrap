/**
 * The one date picker used across the app. It replaces <input type="date">,
 * whose display order follows the browser locale, so every date reads
 * DD-MM-YYYY whatever the browser.
 */
import React, { useEffect, useRef, useState } from 'react';
import IconButton from '@/components/IconButton/IconButton';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/icons/Icons';
import { formatCalendarDate, formatNumericDate, istDateString } from '@/utils/marketStatus';
import { isOutsideRange, isoDate, monthOf, monthWeeks, shiftMonth, type CalendarMonth } from './calendar';
import './DateInput.css';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const PLACEHOLDER = 'DD-MM-YYYY';

interface DateCalendarProps {
  month: CalendarMonth;
  value: string;
  min?: string;
  max?: string;
  /** Today's market (IST) date, marked in the grid. */
  today: string;
  onPick: (date: string) => void;
  onMonthChange: (month: CalendarMonth) => void;
  onClear: () => void;
}

export const DateCalendar: React.FC<DateCalendarProps> = ({ month, value, min, max, today, onPick, onMonthChange, onClear }) => {
  const monthTitle = formatCalendarDate(isoDate(month.year, month.month, 1), { month: 'long', year: 'numeric' });
  return (
    <div className="date-input__popup" role="dialog" aria-label={`Choose a date, ${monthTitle}`}>
      <div className="date-input__header">
        <IconButton icon={<ChevronLeftIcon />} label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))} />
        <span className="date-input__month">{monthTitle}</span>
        <IconButton icon={<ChevronRightIcon />} label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))} />
      </div>
      <div className="date-input__grid">
        {WEEKDAYS.map((day) => <span key={day} className="date-input__weekday">{day}</span>)}
        {monthWeeks(month).flat().map((date, index) => (date ? (
          <button
            key={date}
            type="button"
            className={[
              'date-input__day',
              date === value && 'date-input__day--selected',
              date === today && 'date-input__day--today',
            ].filter(Boolean).join(' ')}
            disabled={isOutsideRange(date, min, max)}
            aria-pressed={date === value}
            aria-label={formatNumericDate(date)}
            onClick={() => onPick(date)}
          >
            {Number(date.slice(8))}
          </button>
        ) : <span key={`blank-${index}`} />))}
      </div>
      <div className="date-input__footer">
        <button type="button" className="date-input__clear" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
};

export interface DateInputProps {
  /** The picked date, YYYY-MM-DD, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** What the date is for (e.g. "From"); read by screen readers. */
  label: string;
}

const DateInput: React.FC<DateInputProps> = ({ value, onChange, min, max, label }) => {
  const [open, setOpen] = useState(false);
  const today = istDateString();
  const [month, setMonth] = useState<CalendarMonth>(() => monthOf(value || today));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setMonth(monthOf(value || today));
    setOpen(!open);
  };
  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <div className="date-input" ref={rootRef}>
      <button
        type="button"
        className="app-date-input date-input__field"
        aria-label={`${label}: ${value ? formatNumericDate(value) : 'no date picked'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={value ? undefined : 'date-input__placeholder'}>{value ? formatNumericDate(value) : PLACEHOLDER}</span>
        <CalendarIcon size={14} />
      </button>
      {open && (
        <DateCalendar
          month={month}
          value={value}
          min={min}
          max={max}
          today={today}
          onPick={pick}
          onMonthChange={setMonth}
          onClear={() => pick('')}
        />
      )}
    </div>
  );
};

export default DateInput;
