import React, { useCallback, useEffect, useState } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { getUsers, updateUserSubscription, AdminUser, SubscriptionAction } from '@/services/admin';
import { getPublicPlans, formatDuration } from '@/services/subscription';
import { SubscriptionPlan } from '@/services/kiteAuth';

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    getPublicPlans().then(setPlans).catch(() => { /* non-fatal */ });
  }, [load]);

  const toggle = (user: AdminUser) => {
    if (expandedId === user.userId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(user.userId);
    setSelectedPlan(user.subscription.planId || plans[0]?.id || '');
  };

  const runAction = async (userId: string, action: SubscriptionAction) => {
    setBusyUser(userId);
    setError(null);
    try {
      await updateUserSubscription(userId, action, action === 'cancel' ? undefined : selectedPlan);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setBusyUser(null);
    }
  };

  const planOptions = plans.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      <div className="admin-filters admin-filters--end">
        <button className="admin-refresh" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {loading ? (
        <div className="admin-empty">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="admin-empty">No registered users yet.</div>
      ) : (
        <div className="admin-table admin-table--users">
          <div className="admin-table__head">
            <span>User</span>
            <span>Subscription</span>
            <span>Last login</span>
            <span />
          </div>

          {users.map((u) => {
            const expanded = expandedId === u.userId;
            const sub = u.subscription;
            return (
              <div className={`admin-row ${expanded ? 'admin-row--expanded' : ''}`} key={u.userId}>
                <button type="button" className="admin-table__row" onClick={() => toggle(u)} aria-expanded={expanded}>
                  <span className="admin-cell admin-cell--user">
                    {u.userName || 'Unknown'}
                    {u.isAdmin && <span className="au-adminflag">Admin</span>}
                  </span>
                  <span className="admin-cell">
                    <span className={`au-status au-status--${sub.status}`}>{sub.status}</span>
                  </span>
                  <span className="admin-cell admin-cell--date">{formatDate(u.lastLogin)}</span>
                  <span className="admin-cell admin-cell--status">
                    <svg className={`admin-chevron ${expanded ? 'admin-chevron--open' : ''}`} width="12" height="8" viewBox="0 0 12 8" fill="none">
                      <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>

                {expanded && (
                  <div className="admin-row__detail">
                    <div className="admin-detail__meta">
                      <div className="admin-detail__field">
                        <span className="admin-detail__label">User ID</span>
                        <span className="admin-detail__value">{u.userId}</span>
                      </div>
                      <div className="admin-detail__field">
                        <span className="admin-detail__label">Plan</span>
                        <span className="admin-detail__value">{sub.planName || 'None'}</span>
                      </div>
                      <div className="admin-detail__field">
                        <span className="admin-detail__label">Expires</span>
                        <span className="admin-detail__value">{formatDate(sub.expiresAt)}</span>
                      </div>
                    </div>

                    <div className="admin-detail__field">
                      <span className="admin-detail__label">Manage subscription</span>
                      <div className="au-manage">
                        <div className="au-manage__select">
                          <AppSelect
                            value={selectedPlan}
                            options={planOptions}
                            onChange={(v) => setSelectedPlan(String(v))}
                            placeholder="Select plan"
                          />
                        </div>
                        <button
                          className="admin-action admin-action--primary"
                          disabled={busyUser === u.userId || !selectedPlan}
                          onClick={() => runAction(u.userId, 'activate')}
                        >
                          Activate
                        </button>
                        <button
                          className="admin-action"
                          disabled={busyUser === u.userId || !selectedPlan}
                          onClick={() => runAction(u.userId, 'extend')}
                        >
                          Extend
                        </button>
                        <button
                          className="admin-action admin-action--danger"
                          disabled={busyUser === u.userId || !sub.active}
                          onClick={() => runAction(u.userId, 'cancel')}
                        >
                          Cancel
                        </button>
                      </div>
                      {selectedPlan && (
                        <span className="au-manage__hint">
                          Extend adds {formatDuration(
                            plans.find((p) => p.id === selectedPlan)?.durationCount || 1,
                            plans.find((p) => p.id === selectedPlan)?.durationUnit || 'month',
                          )} from the current expiry.
                        </span>
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

export default AdminUsers;
