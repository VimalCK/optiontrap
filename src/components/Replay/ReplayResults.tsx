import React, { useEffect, useState } from 'react';
import Message from '@/components/Message/Message';
import { ShimmerGroup, ShimmerTableRows } from '@/components/Shimmer/Shimmer';
import { isAbortError } from '@/services/apiClient';
import { fetchReplaySessions, fetchReplayStats, type ReplayGroup, type ReplayRange, type ReplaySession, type ReplayStats } from '@/services/replay';
import { ReplaySessionStatus, replayReasonLabel } from '../../../shared/appEnums.js';
import { formatAmount, formatSignedAmount } from '@/utils/formatAmount';
import { MessageTone } from '@/utils/uiEnums';

const signedClass = (value: number) => (value >= 0 ? 'replay--profit' : 'replay--loss');
const winRate = (wins: number, trades: number) => (trades ? `${Math.round((wins / trades) * 100)}%` : '–');

const GroupTable: React.FC<{ title: string; keyLabel: string; groups: ReplayGroup[]; label: (key: string | null) => string }> = ({ title, keyLabel, groups, label }) => (
  <section className="replay-card" aria-label={title}>
    <h3 className="replay-card__title">{title}</h3>
    {groups.length === 0 ? <p className="replay-card__empty">No trades yet.</p> : (
      <div className="replay-table-scroll">
        <table className="replay-table">
          <thead className="sticky-head"><tr><th>{keyLabel}</th><th>Trades</th><th>Win rate</th><th>Net ₹</th><th>Per trade ₹</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key ?? 'none'}>
                <td>{label(g.key)}</td>
                <td>{g.trades}</td>
                <td>{winRate(g.wins, g.trades)}</td>
                <td className={signedClass(g.net)}>{formatSignedAmount(g.net)}</td>
                <td className={signedClass(g.averageNet)}>{formatSignedAmount(g.averageNet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

const hourLabel = (key: string | null) => (key ? `${key}:00–${key}:59` : '–');

/** Results of the player's replay trades (each day's first playthrough) in a range, and the sessions played. */
const ReplayResults: React.FC<{ range: ReplayRange }> = ({ range }) => {
  const [stats, setStats] = useState<ReplayStats | null>(null);
  const [sessions, setSessions] = useState<ReplaySession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { from, to, underlying } = range;

  useEffect(() => {
    const controller = new AbortController();
    setStats(null);
    setError(null);
    Promise.all([fetchReplayStats({ from, to, underlying }, controller.signal), fetchReplaySessions({ from, to, underlying }, controller.signal)])
      .then(([loadedStats, loadedSessions]) => { setStats(loadedStats); setSessions(loadedSessions); })
      .catch((err: Error) => { if (!isAbortError(err)) setError(err.message); });
    return () => controller.abort();
  }, [from, to, underlying]);

  if (error) return <Message tone={MessageTone.Error}>{error}</Message>;
  if (!stats) {
    return (
      <ShimmerGroup label="Loading replay results" className="replay-card">
        <table className="replay-table"><tbody><ShimmerTableRows rows={4} columns={5} /></tbody></table>
      </ShimmerGroup>
    );
  }

  const figures = [
    { label: 'Net after charges', value: `₹${formatSignedAmount(stats.net)}`, tone: signedClass(stats.net) },
    { label: 'Trades · win rate', value: `${stats.trades} · ${winRate(stats.wins, stats.trades)}` },
    { label: 'Per trade', value: `₹${formatSignedAmount(stats.averageNet)}`, tone: signedClass(stats.averageNet) },
    { label: 'Average hold', value: `${stats.averageHoldMinutes} min` },
    { label: 'Charges paid', value: `₹${formatAmount(stats.charges)}` },
    { label: 'Days played', value: String(stats.sessions) },
  ];

  return (
    <div className="replay-results">
      <p className="replay-results__note">Only the first time you play a day counts: the second time, you already know how the day went.</p>
      <div className="replay-results__figures">
        {figures.map((f) => (
          <div key={f.label} className="replay-card replay-results__figure">
            <span className="replay-results__label">{f.label}</span>
            <span className={`replay-results__value ${f.tone ?? ''}`}>{f.value}</span>
          </div>
        ))}
      </div>
      <div className="replay-results__groups">
        <GroupTable title="By your reason" keyLabel="Reason" groups={stats.byReason} label={(key) => (key ? replayReasonLabel(key) : 'No reason given')} />
        <GroupTable title="By time of entry" keyLabel="Hour" groups={stats.byHour} label={hourLabel} />
        <GroupTable title="Calls and puts" keyLabel="Type" groups={stats.byOptionType} label={(key) => key ?? '–'} />
      </div>
      <section className="replay-card" aria-label="Sessions played">
        <h3 className="replay-card__title">Sessions played</h3>
        {sessions.length === 0 ? <p className="replay-card__empty">No sessions in this range.</p> : (
          <div className="replay-table-scroll">
            <table className="replay-table">
              <thead className="sticky-head"><tr><th>Day</th><th>Underlying</th><th>Playthrough</th><th>Trades</th><th>Net ₹</th><th>Status</th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{s.underlying}</td>
                    <td>{s.attempt === 1 ? 'First' : `Repeat ${s.attempt}`}</td>
                    <td>{s.status === ReplaySessionStatus.Finished ? s.tradeCount : '–'}</td>
                    <td className={signedClass(s.net)}>{s.status === ReplaySessionStatus.Finished ? formatSignedAmount(s.net) : '–'}</td>
                    <td>{s.status === ReplaySessionStatus.Finished ? 'Played to the close' : 'Left early'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default ReplayResults;
