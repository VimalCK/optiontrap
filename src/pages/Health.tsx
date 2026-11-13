import React, { useCallback, useEffect, useState } from 'react';
import { getHealth, HealthCheck, HealthReport } from '@/services/admin';
import {
  ConnectionIcon, SettingsIcon, LinkIcon, UserIcon, AnalyticsIcon, AutomationIcon, CalendarIcon,
} from '@/components/icons/Icons';
import { formatCalendarDate, istDateString, istTimeLabel } from '@/utils/marketStatus';
import { HealthStatus } from '../../shared/appEnums.js';
import { HealthTone, type HealthToneId, MessageTone } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import '@/styles/admin.css';
import LoadingState from '@/components/LoadingState/LoadingState';

/** How long ago, roughly: "just now", "12m ago", "3h ago", "2d ago". */
const timeAgo = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

const formatUptime = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const CHECK_BADGES: Record<HealthCheck['status'], { tone: HealthToneId; label: string }> = {
  [HealthStatus.Pass]: { tone: HealthTone.Up, label: 'OK' },
  [HealthStatus.Warn]: { tone: HealthTone.Warn, label: 'Warning' },
  [HealthStatus.Fail]: { tone: HealthTone.Down, label: 'Failing' },
};

/** When a check was observed, in IST: the time today, with the date on other days. */
export const checkTimeLabel = (time: string, now: Date = new Date()): string => {
  const at = new Date(time);
  const day = istDateString(at);
  const date = day === istDateString(now) ? '' : `${formatCalendarDate(day, { day: '2-digit', month: 'short' })} `;
  return `${date}${istTimeLabel(at)} IST`;
};

/**
 * The OI data feed row: when the newest snapshot was taken (IST, and how long
 * ago), whatever its day, and whether it is from today (Fresh) or not (Idle).
 */
export function oiFeedStatus(newest: number | null, now: Date = new Date()): { text: string; fresh: boolean } {
  if (newest === null) return { text: 'No snapshots yet', fresh: false };
  const at = new Date(newest);
  return {
    text: `Last snapshot ${checkTimeLabel(at.toISOString(), now)} · ${timeAgo(now.getTime() - newest)}`,
    fresh: istDateString(at) === istDateString(now),
  };
}

export const HealthCheckRow: React.FC<{ icon: React.ReactNode; name: string; check: HealthCheck }> = ({ icon, name, check }) => {
  const badge = CHECK_BADGES[check.status];
  return (
    <div className="hx-service">
      <span className="hx-service__icon">{icon}</span>
      <div className="hx-service__body">
        <strong>{name}</strong>
        <small>{check.time ? `${check.output} · ${checkTimeLabel(check.time)}` : check.output}</small>
      </div>
      <span className={`hx-badge hx-badge--${badge.tone.toLowerCase()}`}><i />{badge.label}</span>
    </div>
  );
};

const secondsAgo = (ts: number) => Math.max(0, Math.round((Date.now() - ts) / 1000));

const Health: React.FC = () => {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-render for the "checked Xs ago" line

  const load = useCallback(async () => {
    setError(null);
    try {
      setHealth(await getHealth());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, 20000);
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(refresh); clearInterval(ticker); };
  }, [load]);

  if (loading && !health) {
    return <LoadingState label="Loading diagnostics…" />;
  }
  if (!health) {
    return error ? <Message tone={MessageTone.Error}>{error}</Message> : null;
  }

  const healthy = health.db.connected;
  const feedbackTotal = health.feedback.total;
  const feedbackOpen = health.feedback.open;
  const openPct = feedbackTotal > 0 ? Math.round((feedbackOpen / feedbackTotal) * 100) : 0;
  const oiFeed = oiFeedStatus(health.lastOiUpdate);

  return (
    <>
      {error && <Message tone={MessageTone.Error}>{error}</Message>}

      <div className={`hx-hero hx-hero--${(healthy ? HealthTone.Up : HealthTone.Down).toLowerCase()}`}>
        <div className="hx-hero__pulse"><span /></div>
        <div className="hx-hero__text">
          <h2>{healthy ? 'All systems operational' : 'Service disruption'}</h2>
          <p>
            {healthy
              ? 'Database is reachable and the app is serving requests.'
              : 'The database is not responding — investigate immediately.'}
          </p>
        </div>
        <div className="hx-hero__meta">
          <span className="hx-hero__checked">Checked {secondsAgo(health.timestamp)}s ago</span>
          <button className="admin-refresh" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      <div className="hx-panels">
        <div className="hx-panel">
          <div className="hx-panel__title">Services</div>

          <div className="hx-service">
            <span className="hx-service__icon"><ConnectionIcon size={18} /></span>
            <div className="hx-service__body">
              <strong>Database</strong>
              <small>PostgreSQL connection</small>
            </div>
            <span className={`hx-badge hx-badge--${(health.db.connected ? HealthTone.Up : HealthTone.Down).toLowerCase()}`}>
              <i />{health.db.connected ? 'Connected' : 'Down'}
            </span>
          </div>

          <div className="hx-service">
            <span className="hx-service__icon"><SettingsIcon size={18} /></span>
            <div className="hx-service__body">
              <strong>Server</strong>
              <small>Uptime {formatUptime(health.server.uptimeSeconds)} · {health.server.mode}</small>
            </div>
            <span className="hx-badge hx-badge--up"><i />Running</span>
          </div>

          <div className="hx-service">
            <span className="hx-service__icon"><LinkIcon size={18} /></span>
            <div className="hx-service__body">
              <strong>Kite Session</strong>
              <small>{health.kite.connected ? (health.kite.userName || health.kite.userId || 'Connected') : 'No live broker session'}</small>
            </div>
            <span className={`hx-badge hx-badge--${(health.kite.connected ? HealthTone.Up : HealthTone.Idle).toLowerCase()}`}>
              <i />{health.kite.connected ? 'Active' : 'Offline'}
            </span>
          </div>

          <div className="hx-service">
            <span className="hx-service__icon"><AnalyticsIcon size={18} /></span>
            <div className="hx-service__body">
              <strong>OI Data Feed</strong>
              <small>{oiFeed.text}</small>
            </div>
            <span className={`hx-badge hx-badge--${(oiFeed.fresh ? HealthTone.Up : HealthTone.Idle).toLowerCase()}`}>
              <i />{oiFeed.fresh ? 'Fresh' : 'Idle'}
            </span>
          </div>

          <HealthCheckRow icon={<AutomationIcon size={18} />} name="Trade Engine" check={health.checks.tradeEngine} />
          <HealthCheckRow icon={<CalendarIcon size={18} />} name="Nightly Jobs" check={health.checks.nightlyJobs} />
        </div>

        <div className="hx-metrics">
          <div className="hx-stat">
            <span className="hx-stat__icon"><UserIcon size={18} /></span>
            <strong className="hx-stat__value">{health.usage.activeSessions}</strong>
            <span className="hx-stat__label">Active users</span>
            <span className="hx-stat__meta">{health.usage.totalUsers} registered</span>
          </div>

          <div className="hx-stat hx-stat--ring">
            <div
              className="hx-ring"
              style={{ ['--pct' as string]: `${openPct}` }}
            >
              <span>{feedbackOpen}</span>
            </div>
            <div className="hx-stat__ringtext">
              <span className="hx-stat__label">Open feedback</span>
              <span className="hx-stat__meta">{feedbackTotal} total submitted</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Health;
