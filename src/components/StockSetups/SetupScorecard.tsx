import React, { useEffect, useState } from 'react';
import { setupLabel } from '../../../shared/stockSetups.js';
import { fetchSetupScorecard, type SetupStats, type TrackedSetup } from '@/services/stockSetups';
import { isAbortError } from '@/services/apiClient';

const STATUS_TEXT: Record<TrackedSetup['status'], string> = {
  open: 'Open',
  target: 'Target hit',
  stop: 'Stopped',
  expired: 'Expired',
};

/** Share of resolved setups that reached the target before the stop; expiries count as neither. */
function winRate(s: SetupStats): string {
  const decided = s.target + s.stop;
  return decided ? `${Math.round((s.target / decided) * 100)}%` : '—';
}

/** How each setup type has actually played out on one stock since tracking began. */
const SetupScorecard: React.FC<{ instrumentToken: number; tradingsymbol: string; refreshKey: number }> = ({ instrumentToken, tradingsymbol, refreshKey }) => {
  const [data, setData] = useState<{ stats: SetupStats[]; recent: TrackedSetup[] } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSetupScorecard(instrumentToken, controller.signal)
      .then(setData)
      .catch((err) => { if (!isAbortError(err)) console.error('[Watchlist] Scorecard load failed:', err); });
    return () => controller.abort();
  }, [instrumentToken, refreshKey]);

  return (
    <div className="wl-alerts wl-scorecard">
      <div className="wl-alerts__header">
        <div>
          <h3 className="wl-alerts__title">Setup scorecard · {tradingsymbol}</h3>
          <p className="wl-alerts__desc">Every setup the after-close scan finds on {tradingsymbol} is followed for up to 20 sessions until it hits its target or stop.</p>
        </div>
      </div>
      {!data ? (
        <div className="wl-alerts__empty">Loading…</div>
      ) : data.stats.length === 0 ? (
        <div className="wl-alerts__empty">No setups tracked for {tradingsymbol} yet. They appear when the after-close scan finds one, or add the past year with the history button in its entry and exit zones panel.</div>
      ) : (
        <div className="wl-alerts__table-wrap">
          <table className="wl-alerts-table wl-scorecard__summary">
            <thead>
              <tr>
                <th>Setup</th>
                <th className="wl-alerts-table__num">Tracked</th>
                <th className="wl-alerts-table__num">Target</th>
                <th className="wl-alerts-table__num">Stop</th>
                <th className="wl-alerts-table__num">Expired</th>
                <th className="wl-alerts-table__num">Open</th>
                <th className="wl-alerts-table__num" title="Target hits ÷ (target hits + stops)">Win rate</th>
                <th className="wl-alerts-table__num" title="Average best and worst move while tracked">Avg best / worst</th>
              </tr>
            </thead>
            <tbody>
              {data.stats.map((s) => (
                <tr key={s.setupType}>
                  <td><span className={`wl-setup-chip wl-setup-chip--${s.direction}`}>{s.direction === 'buy' ? 'Buy' : 'Sell'}</span> {setupLabel(s.setupType)}</td>
                  <td className="wl-alerts-table__num">{s.total}</td>
                  <td className="wl-alerts-table__num">{s.target}</td>
                  <td className="wl-alerts-table__num">{s.stop}</td>
                  <td className="wl-alerts-table__num">{s.expired}</td>
                  <td className="wl-alerts-table__num">{s.open}</td>
                  <td className="wl-alerts-table__num">{winRate(s)}</td>
                  <td className="wl-alerts-table__num">
                    {s.avgFavorablePct === null ? '—' : `+${s.avgFavorablePct.toFixed(1)}% / −${(s.avgAdversePct ?? 0).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length > 0 && (
            <div className="wl-scorecard__recent-wrap">
              <table className="wl-alerts-table wl-scorecard__recent">
                <thead>
                  <tr>
                    <th>Recent</th>
                    <th>Setup</th>
                    <th className="wl-alerts-table__num">Entry</th>
                    <th className="wl-alerts-table__num">Stop</th>
                    <th className="wl-alerts-table__num">Target</th>
                    <th className="wl-alerts-table__center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((s) => (
                    <tr key={s.id}>
                      <td>{s.signalDate}</td>
                      <td><span className={`wl-setup-chip wl-setup-chip--${s.direction}`}>{s.direction === 'buy' ? 'Buy' : 'Sell'}</span> {setupLabel(s.setupType)}</td>
                      <td className="wl-alerts-table__num">{s.entry.toFixed(2)}</td>
                      <td className="wl-alerts-table__num">{s.stop.toFixed(2)}</td>
                      <td className="wl-alerts-table__num">{s.target.toFixed(2)}</td>
                      <td className="wl-alerts-table__center">
                        <span className={`wl-scorecard__status wl-scorecard__status--${s.status}`}>{STATUS_TEXT[s.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SetupScorecard;
