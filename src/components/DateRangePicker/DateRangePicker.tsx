/**
 * DateRangePicker — From / To date pickers for a range of market (IST) days,
 * used wherever a screen fetches by range (Algo Trading trades, Win/Loss
 * Patterns). To can't be set before From. The caller checks the range with
 * rangeProblem (TradeJournal/journalRange) before fetching. Each picker is the
 * shared DateInput, so dates read day, month, year.
 */
import React from 'react';
import DateInput from '@/components/DateInput/DateInput';
import './DateRangePicker.css';

export interface DateRange { from: string; to: string }

const DateRangePicker: React.FC<{ range: DateRange; onChange: (range: DateRange) => void }> = ({ range, onChange }) => (
  <div className="date-range">
    <div className="date-range__label">
      From
      <DateInput label="From" value={range.from} max={range.to || undefined}
        onChange={(from) => onChange({ ...range, from })} />
    </div>
    <div className="date-range__label">
      To
      <DateInput label="To" value={range.to} min={range.from || undefined}
        onChange={(to) => onChange({ ...range, to })} />
    </div>
  </div>
);

export default DateRangePicker;
