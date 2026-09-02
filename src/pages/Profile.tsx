import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectionIcon, PowerIcon } from '@/components/icons/Icons';
import { getSession, logout, deleteAccount, KiteSession } from '@/services/kiteAuth';
import { fetchMargins, Margins } from '@/services/kiteApi';
import { notifySessionChange } from '@/hooks/useKiteSession';
import '@/styles/settings.css';

const formatSubscriptionDate = (value: string | null | undefined) => {
  if (!value) return 'No expiry';

  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatSubscriptionStatus = (value: string | undefined) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Inactive';

const getDaysRemaining = (value: string | null | undefined) => {
  if (!value) return null;

  const expiresAt = new Date(value.replace(' ', 'T')).getTime();
  if (Number.isNaN(expiresAt)) return null;

  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)));
};

interface UserProfile {
  userId: string;
  userName: string;
  userShortname: string;
  email: string;
  broker: string;
  userType: string;
  exchanges: string[];
  products: string[];
  orderTypes: string[];
  avatarUrl: string | null;
}

const Profile: React.FC = () => {
  const navigate = useNavigate();

  const [session, setSession] = useState<KiteSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [margins, setMargins] = useState<Margins | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const subscription = session?.subscription;
  const daysRemaining = getDaysRemaining(subscription?.expiresAt);

  useEffect(() => {
    const currentSession = getSession();
    setSession(currentSession);

    if (currentSession) {
      fetchProfile();
      loadMargins();
    }
  }, []);

  const fetchProfile = async () => {
    setProfileLoading(true);
    try {
      const response = await fetch('/api/user/profile', {
        credentials: 'include',
      });
      if (response.ok) {
        const result = await response.json();
        const data = result.data;
        setProfile({
          userId: data.user_id,
          userName: data.user_name,
          userShortname: data.user_shortname,
          email: data.email,
          broker: data.broker,
          userType: data.user_type,
          exchanges: data.exchanges || [],
          products: data.products || [],
          orderTypes: data.order_types || [],
          avatarUrl: data.avatar_url || null,
        });
      }
    } catch (err) {
      console.error('[Profile] Failed to fetch user profile:', err);
    } finally {
      setProfileLoading(false);
    }
  };

  const loadMargins = async () => {
    try {
      const data = await fetchMargins();
      setMargins(data);
    } catch (err) {
      console.error('[Profile] Failed to fetch margins:', err);
    }
  };

  const handleLogout = async () => {
    await logout();
    setSession(null);
    setProfile(null);
    notifySessionChange();
    navigate('/login');
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      notifySessionChange();
      navigate('/login');
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ position: 'relative' }}>
        <div>
          <h1 className="page-header__title">Profile</h1>
          <p className="page-header__subtitle">
            Your account and session information
          </p>
        </div>
        <button
          className="btn btn--danger profile-logout-btn"
          onClick={handleLogout}
          aria-label="Logout"
          title="Logout"
        >
          <PowerIcon size={22} />
        </button>
      </div>

      {/* Merged session + account details card */}
      <div className="card profile-merged-card">
        {/* Left — avatar + account detail rows */}
        <div className="profile-merged-card__left">
          <div className="profile-merged-card__top">
            {session && profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={session.userName}
                className="profile-avatar"
              />
            ) : (
              <div className="card__icon">
                <ConnectionIcon />
              </div>
            )}
          </div>
          {session && profile ? (
            <div className="profile-details">
              <div className="profile-details__row">
                <span className="profile-details__label">Name</span>
                <span className="profile-details__value">{profile.userName}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">User ID</span>
                <span className="profile-details__value">{profile.userId}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">Email</span>
                <span className="profile-details__value">{profile.email}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">Broker</span>
                <span className="profile-details__value">{profile.broker}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">Account Type</span>
                <span className="profile-details__value">{profile.userType}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">Exchanges</span>
                <span className="profile-details__value">{profile.exchanges.join(', ')}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">Products</span>
                <span className="profile-details__value">{profile.products.join(', ')}</span>
              </div>
              <div className="profile-details__row">
                <span className="profile-details__label">Order Types</span>
                <span className="profile-details__value">{profile.orderTypes.join(', ')}</span>
              </div>
            </div>
          ) : profileLoading ? (
            <p className="card__description">Loading profile...</p>
          ) : null}
        </div>

        <div className="profile-merged-card__divider" />

        {/* Right — funds */}
        <div className="profile-merged-card__right">
          {session && (
            <>
              <div className="profile-merged-card__top">
                <h3 className="card__title">Funds</h3>
              </div>
              {margins?.equity && (
                <div className="profile-details">
                  <div className="profile-details__row">
                    <span className="profile-details__label">Opening Balance</span>
                    <span className="profile-details__value">{margins.equity.available.opening_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="profile-details__row">
                    <span className="profile-details__label">Used Margin</span>
                    <span className="profile-details__value">{margins.equity.utilised.debits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="profile-details__row">
                    <span className="profile-details__label">Available Margin</span>
                    <span className="profile-details__value">{(margins.equity.available.live_balance + margins.equity.available.collateral).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card profile-subscription-card">
        <div className="profile-subscription-card__header">
          <div>
            <span className="profile-subscription-card__eyebrow">Membership</span>
            <h3 className="profile-subscription-card__title">{subscription?.plan?.name || 'No active plan'}</h3>
            <p className="profile-subscription-card__subtitle">
              {subscription?.active
                ? 'Your OptionTrap access is active.'
                : 'Activate a plan to unlock OptionTrap features.'}
            </p>
          </div>
          <div className="profile-subscription-card__status">
            <span className={`profile-subscription-badge ${subscription?.active ? 'profile-subscription-badge--active' : 'profile-subscription-badge--inactive'}`}>
              {formatSubscriptionStatus(subscription?.status)}
            </span>
            <strong>{daysRemaining === null ? '-' : `${daysRemaining} days`}</strong>
            <small>remaining</small>
          </div>
        </div>

        <div className="profile-subscription-grid">
          <div className="profile-subscription-stat">
            <span>Plan</span>
            <strong>{subscription?.plan?.name || 'No active plan'}</strong>
          </div>
          <div className="profile-subscription-stat">
            <span>Billing Cycle</span>
            <strong>{subscription?.plan?.interval || '-'}</strong>
          </div>
          <div className="profile-subscription-stat">
            <span>Started</span>
            <strong>{formatSubscriptionDate(subscription?.startsAt)}</strong>
          </div>
          <div className="profile-subscription-stat">
            <span>Expires</span>
            <strong>{formatSubscriptionDate(subscription?.expiresAt)}</strong>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card profile-danger-zone" style={{ marginTop: 24 }}>
        <div className="profile-danger-zone__content">
          <div>
            <p className="profile-danger-zone__desc">
              Permanently delete your profile from OptionTrap. You will no longer be able to access your watchlists,
              paper trades, analytics data, and other data saved for option analytics. You can re-register later with the same
              or different Kite credentials.
            </p>
          </div>
          {!showDeleteConfirm ? (
            <button
              className="btn btn--danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Account
            </button>
          ) : (
            <div className="profile-danger-zone__confirm">
              <p className="profile-danger-zone__warning">
                This will delete your stored credentials and log you out. Are you sure?
              </p>
              <div className="profile-danger-zone__actions">
                <button
                  className="btn btn--danger"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  className="btn"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;
