/**
 * DateRangePicker — From / To date inputs for a range of market (IST) days,
 * used wherever a screen fetches by range (Algo Trading trades, Win/Loss
 * Patterns). To can't be set before From. The caller checks the range with
 * rangeProblem (TradeJournal/journalRange) before fetching.
 */
import React from 'react';
import './DateRangePicker.css';

export interface DateRange { from: string; to: string }

const DateRangePicker: React.FC<{ range: DateRange; onChange: (range: DateRange) => void }> = ({ range, onChange }) => (
  <div className="date-range">
    <label className="date-range__label">
      From
      <input type="date" className="app-date-input" value={range.from} max={range.to || undefined}
        onChange={(e) => onChange({ ...range, from: e.target.value })} />
    </label>
    <label className="date-range__label">
      To
      <input type="date" className="app-date-input" value={range.to} min={range.from || undefined}
        onChange={(e) => onChange({ ...range, to: e.target.value })} />
    </label>
  </div>
);

export default DateRangePicker;
