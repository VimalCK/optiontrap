import React, { useState } from 'react';
import { formatNumericDate } from '@/utils/marketStatus';
import type { TradeSignalRow } from './types';
import { formatReturn, todayIST } from './helpers';
import { expiryLabel } from './expiries';
import { SignalOutcome } from '../../../shared/appEnums.js';

const formatPrice = (value: number | null) => (value === null || !(value > 0) ? '-' : value.toFixed(2));
const shortDate = (date: string | null) => (date ? expiryLabel(date.slice(0, 10), false) : '-');

/** Signals on an expiry that hasn't passed yet (expiry today counts as upcoming). */
export function upcomingSignals(rows: TradeSignalRow[], today: string): TradeSignalRow[] {
  return rows.filter((row) => !row.expiry || row.expiry >= today);
}

/** Upcoming expiries by default; All adds the expired ones. */
export const SignalResultsGrid: React.FC<{ rows: TradeSignalRow[]; today?: string; onDelete?: (id: number) => void }> = ({ rows, today = todayIST(), onDelete }) => {
  const [showExpired, setShowExpired] = useState(false);
  const upcoming = upcomingSignals(rows, today);
  const expiredCount = rows.length - upcoming.length;
  const visibleRows = showExpired ? rows : upcoming;

  return (
    <div className="oi-history__signal-grid-wrap">
      <div className="oi-history__signal-grid-toolbar">
        <span>
          {showExpired
            ? `All ${rows.length} signals`
            : `${upcoming.length} signal${upcoming.length === 1 ? '' : 's'} on upcoming expiries`}
        </span>
        <div className="oi-history__metric-toggle" role="group" aria-label="Signals to show">
          <button type="button" className={`oi-history__volume-toggle ${!showExpired ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowExpired(false)} aria-pressed={!showExpired}>Upcoming</button>
          <button type="button" className={`oi-history__volume-toggle ${showExpired ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowExpired(true)} aria-pressed={showExpired}>All{expiredCount > 0 ? ` (${rows.length})` : ''}</button>
        </div>
      </div>
      {visibleRows.length === 0 ? (
        <div className="oi-history__signal-grid-empty">
          No signals on upcoming expiries.{expiredCount > 0 ? ` ${expiredCount} expired signal${expiredCount === 1 ? ' is' : 's are'} under All.` : ''}
        </div>
      ) : (
        <div className="oi-history__signal-grid-scroll">
          <table className="oi-history__signal-grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Signal</th>
                <th>Expiry</th>
                <th>Entry</th>
                <th>Last</th>
                <th>Return</th>
                <th>Best</th>
                <th>Worst</th>
                <th>Result</th>
                {onDelete && <th aria-label="Delete" />}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const status = row.outcome_status || SignalOutcome.Open;
                return (
                  <tr key={row.id} className={status === SignalOutcome.Loss ? 'is-loss' : status === SignalOutcome.Profit ? 'is-profit' : ''}>
                    <td>{shortDate(row.signal_date)}</td>
                    <td className="oi-history__signal-grid-signal">{row.action} {row.option_type} {row.strike}</td>
                    <td>{shortDate(row.expiry)}</td>
                    <td>{formatPrice(row.entry_premium)}</td>
                    <td title={row.outcome_date ? `as of ${formatNumericDate(row.outcome_date)}` : undefined}>{formatPrice(row.outcome_price)}</td>
                    <td className={row.outcome_return === null ? '' : row.outcome_return >= 0 ? 'is-up' : 'is-down'}>{formatReturn(row.outcome_return)}</td>
                    <td>{formatReturn(row.max_favorable_return)}</td>
                    <td>{formatReturn(row.max_adverse_return)}</td>
                    <td>
                      {status}
                      {status !== SignalOutcome.Open && !row.outcome_final && <small> · live</small>}
                    </td>
                    {onDelete && (
                      <td className="oi-history__signal-grid-delete">
                        <button type="button" className="oi-history__signal-delete" onClick={() => onDelete(row.id)} title="Delete this signal" aria-label={`Delete ${row.action} ${row.option_type} ${row.strike} signal`}>×</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
