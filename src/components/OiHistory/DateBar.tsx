import React from 'react';
import { formatFullDateLabel, formatMonthShortLabel } from './helpers';
import { groupDatesByMonth } from './oiTable';

/** The stored dates as day buttons grouped by month; contract expiry days are marked. */
const DateBar: React.FC<{ dates: string[]; selected: string; expiryDates: Set<string>; onSelect: (date: string) => void }> = ({ dates, selected, expiryDates, onSelect }) => {
  if (dates.length === 0) return null;
  return (
    <div className="oi-history__date-bar">
      {groupDatesByMonth(dates).map(({ month, dates: days }) => (
        <div key={month} className="oi-history__date-group">
          <span className="oi-history__date-group-label">{formatMonthShortLabel(month)}</span>
          <div className="oi-history__date-group-days">
            {days.map((d) => {
              const isExpiryDay = expiryDates.has(d);
              return (
                <button
                  key={d}
                  className={`oi-history__date-btn ${selected === d ? 'oi-history__date-btn--active' : ''} ${isExpiryDay ? 'oi-history__date-btn--weekly-expiry' : ''}`}
                  onClick={() => onSelect(d)}
                  title={`${formatFullDateLabel(d)}${isExpiryDay ? ' — Expiry day' : ''}`}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DateBar;
