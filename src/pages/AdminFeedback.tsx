import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import {
  getFeedback,
  updateFeedbackStatus,
  FeedbackItem,
  FeedbackStatus,
} from '@/services/admin';
import { FeedbackType } from '@/services/feedback';

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'general', label: 'General' },
  { value: 'subscription', label: 'Subscription' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'resolved', label: 'Resolved' },
];

const formatDate = (value: string) => {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const AdminFeedback: React.FC = () => {
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FeedbackType | ''>('');
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFeedback({ type: typeFilter, status: statusFilter });
      setFeedback(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: string, status: FeedbackStatus) => {
    setUpdatingId(id);
    setError(null);
    try {
      await updateFeedbackStatus(id, status);
      if (statusFilter) {
        await load();
      } else {
        setFeedback((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feedback');
    } finally {
      setUpdatingId(null);
    }
  };

  const counts = useMemo(() => {
    const base = { open: 0, reviewed: 0, resolved: 0 };
    for (const item of feedback) base[item.status] += 1;
    return base;
  }, [feedback]);

  return (
    <>
      <div className="admin-summary">
        <span className="admin-chip admin-chip--open">{counts.open} Open</span>
        <span className="admin-chip admin-chip--reviewed">{counts.reviewed} Reviewed</span>
        <span className="admin-chip admin-chip--resolved">{counts.resolved} Resolved</span>
      </div>

      <div className="admin-filters">
        <div className="admin-filter">
          <label className="admin-filter__label">Type</label>
          <AppSelect
            value={typeFilter}
            options={TYPE_OPTIONS}
            onChange={(v) => setTypeFilter(v as FeedbackType | '')}
          />
        </div>
        <div className="admin-filter">
          <label className="admin-filter__label">Status</label>
          <AppSelect
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(v) => setStatusFilter(v as FeedbackStatus | '')}
          />
        </div>
        <button className="admin-refresh" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {loading ? (
        <div className="admin-empty">Loading feedback...</div>
      ) : feedback.length === 0 ? (
        <div className="admin-empty">No feedback matches the current filters.</div>
      ) : (
        <div className="admin-table">
          <div className="admin-table__head">
            <span>Submitted</span>
            <span>User</span>
            <span>Type</span>
            <span>Message</span>
            <span>Status</span>
          </div>
          {feedback.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div className={`admin-row ${expanded ? 'admin-row--expanded' : ''}`} key={item.id}>
                <button
                  type="button"
                  className="admin-table__row"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  aria-expanded={expanded}
                >
                  <span className="admin-cell admin-cell--date">{formatDate(item.createdAt)}</span>
                  <span className="admin-cell admin-cell--user">{item.userName || 'Unknown'}</span>
                  <span className="admin-cell admin-cell--type">
                    <span className={`admin-type admin-type--${item.type}`}>{item.type}</span>
                  </span>
                  <span className="admin-cell admin-cell--message">{item.message}</span>
                  <span className="admin-cell admin-cell--status">
                    <span className={`admin-status admin-status--${item.status}`}>{item.status}</span>
                    <svg
                      className={`admin-chevron ${expanded ? 'admin-chevron--open' : ''}`}
                      width="12" height="8" viewBox="0 0 12 8" fill="none"
                    >
                      <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>

                {expanded && (
                  <div className="admin-row__detail">
                    <div className="admin-detail__meta">
                      <div className="admin-detail__field">
                        <span className="admin-detail__label">User ID</span>
                        <span className="admin-detail__value">{item.userId}</span>
                      </div>
                      {item.pageUrl && (
                        <div className="admin-detail__field">
                          <span className="admin-detail__label">Page</span>
                          <span className="admin-detail__value">{item.pageUrl}</span>
                        </div>
                      )}
                    </div>

                    <div className="admin-detail__field">
                      <span className="admin-detail__label">Message</span>
                      <div className="admin-detail__messagebox">
                        <p className="admin-detail__message">{item.message}</p>
                      </div>
                    </div>

                    <div className="admin-detail__actions">
                      {item.status !== 'reviewed' && (
                        <button
                          className="admin-action"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusChange(item.id, 'reviewed')}
                        >
                          Mark reviewed
                        </button>
                      )}
                      {item.status !== 'resolved' && (
                        <button
                          className="admin-action admin-action--primary"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusChange(item.id, 'resolved')}
                        >
                          Resolve
                        </button>
                      )}
                      {item.status !== 'open' && (
                        <button
                          className="admin-action admin-action--ghost"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusChange(item.id, 'open')}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default AdminFeedback;
