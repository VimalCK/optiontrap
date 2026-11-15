import React from 'react';
import type { TradeSignalRow } from './types';
import { summarizeSignalBreakdown, MIN_SCORED_FOR_VERDICT } from './signalStats';
import { formatReturn } from './helpers';
import { signalVerdictLabel } from '../../../shared/analysisEnums.js';

export const SignalBreakdownTable: React.FC<{ signals: TradeSignalRow[] }> = ({ signals }) => {
  const rows = summarizeSignalBreakdown(signals);
  const groups = [...new Set(rows.map((row) => row.group))];
  const hasPatterns = groups.includes('OI pattern');

  return (
    <div className="oi-history__signal-breakdown-wrap">
      <div className="oi-history__signal-breakdown-title">
        <strong>What works</strong>
        <span>
          Drop a slice that stays Losing. Verdicts need {MIN_SCORED_FOR_VERDICT}+ scored signals.
          {!hasPatterns && ' OI pattern and flow are recorded on new signals from now on.'}
        </span>
      </div>
      <div className="oi-history__signal-grid-scroll oi-history__signal-grid-scroll--auto">
        <table className="oi-history__signal-grid oi-history__signal-breakdown-table">
          <thead>
            <tr>
              <th>Slice</th>
              <th>Signals</th>
              <th>Scored</th>
              <th>Win rate</th>
              <th>Avg return</th>
              <th>Avg worst</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <React.Fragment key={group}>
                <tr className="is-group">
                  <td colSpan={7}>{group}</td>
                </tr>
                {rows.filter((row) => row.group === group).map((row) => (
                  <tr key={`${group}-${row.label}`}>
                    <td>{row.label}</td>
                    <td>{row.total}</td>
                    <td>{row.scored}</td>
                    <td>{row.winRate === null ? '-' : `${row.winRate.toFixed(0)}%`}</td>
                    <td className={row.averageReturn === null ? '' : row.averageReturn >= 0 ? 'is-up' : 'is-down'}>{formatReturn(row.averageReturn)}</td>
                    <td>{formatReturn(row.averageMaxAdverse)}</td>
                    <td>
                      <span className={`oi-history__signal-verdict oi-history__signal-verdict--${row.verdict.toLowerCase()}`}>{signalVerdictLabel(row.verdict)}</span>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
