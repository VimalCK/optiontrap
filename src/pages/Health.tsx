import React, { useCallback, useEffect, useState } from 'react';
import { getHealth, HealthStatus } from '@/services/admin';
import {
  ConnectionIcon, SettingsIcon, LinkIcon, UserIcon, AnalyticsIcon,
} from '@/components/icons/Icons';
import '@/styles/admin.css';

const formatWhen = (ts: number | null) => {
  if (!ts) return 'No data yet';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const mins = Math.floor((Date.now() - ts) / 60000);
  let rel: string;
  if (mins < 1) rel = 'just now';
  else if (mins < 60) rel = `${mins}m ago`;
  else if (mins < 1440) rel = `${Math.floor(mins / 60)}h ago`;
  else rel = `${Math.floor(mins / 1440)}d ago`;

  return `${date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${rel}`;
};

const formatUptime = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const secondsAgo = (ts: number) => Math.max(0, Math.round((Date.now() - ts) / 1000));

const Health: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
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
    return <div className="admin-empty">Loading diagnostics...</div>;
  }
  if (!health) {
    return error ? <div className="admin-error">{error}</div> : null;
  }

  const healthy = health.db.connected;
  const feedbackTotal = health.feedback.total;
  const feedbackOpen = health.feedback.open;
  const openPct = feedbackTotal > 0 ? Math.round((feedbackOpen / feedbackTotal) * 100) : 0;

  return (
    <>
      {error && <div className="admin-error">{error}</div>}

      {/* Overall status hero */}
      <div className={`hx-hero hx-hero--${healthy ? 'up' : 'down'}`}>
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

      {/* Service status list */}
      <div className="hx-panels">
        <div className="hx-panel">
          <div className="hx-panel__title">Services</div>

          <div className="hx-service">
            <span className="hx-service__icon"><ConnectionIcon size={18} /></span>
            <div className="hx-service__body">
              <strong>Database</strong>
              <small>PostgreSQL connection</small>
            </div>
            <span className={`hx-badge hx-badge--${health.db.connected ? 'up' : 'down'}`}>
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
            <span className={`hx-badge hx-badge--${health.kite.connected ? 'up' : 'idle'}`}>
              <i />{health.kite.connected ? 'Active' : 'Offline'}
            </span>
          </div>

          <div className="hx-service">
            <span className="hx-service__icon"><AnalyticsIcon size={18} /></span>
            <div className="hx-service__body">
              <strong>OI Data Feed</strong>
              <small>Last snapshot {formatWhen(health.lastOiUpdate)}</small>
            </div>
            <span className={`hx-badge hx-badge--${health.lastOiUpdate ? 'up' : 'idle'}`}>
              <i />{health.lastOiUpdate ? 'Fresh' : 'Idle'}
            </span>
          </div>
        </div>

        {/* Metrics */}
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
