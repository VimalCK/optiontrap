import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectionIcon, IdCardIcon, ShieldIcon, PowerIcon } from '@/components/icons/Icons';
import { getSession, logout, getAuthHeader, clearSession, KiteSession } from '@/services/kiteAuth';
import { fetchMargins, Margins } from '@/services/kiteApi';
import { notifySessionChange } from '@/hooks/useKiteSession';
import '@/styles/settings.css';

const KITE_STORAGE_KEY = 'optiontrap_kite_credentials';

interface KiteCredentials {
  apiKey: string;
  apiSecret: string;
}

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

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [session, setSession] = useState<KiteSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [margins, setMargins] = useState<Margins | null>(null);

  // Track the saved values to detect dirty state
  const savedKeyRef = useRef('');
  const savedSecretRef = useRef('');

  useEffect(() => {
    const stored = localStorage.getItem(KITE_STORAGE_KEY);
    if (stored) {
      const credentials: KiteCredentials = JSON.parse(stored);
      setApiKey(credentials.apiKey);
      setApiSecret(credentials.apiSecret);
      savedKeyRef.current = credentials.apiKey;
      savedSecretRef.current = credentials.apiSecret;
    }
    const currentSession = getSession();
    setSession(currentSession);

    if (currentSession) {
      fetchProfile();
      loadMargins();
    }
  }, []);

  const fetchProfile = async () => {
    const authHeader = getAuthHeader();
    if (!authHeader) return;

    setProfileLoading(true);
    try {
      const response = await fetch('/api/user/profile', {
        headers: {
          'X-Kite-Version': '3',
          'Authorization': authHeader,
        },
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

  const handleSave = () => {
    const credentials: KiteCredentials = { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
    localStorage.setItem(KITE_STORAGE_KEY, JSON.stringify(credentials));
    savedKeyRef.current = credentials.apiKey;
    savedSecretRef.current = credentials.apiSecret;
    // Clear session — new credentials require a fresh login
    clearSession();
    notifySessionChange();
    navigate('/login');
  };

  const handleLogout = async () => {
    await logout();
    setSession(null);
    setProfile(null);
    notifySessionChange();
  };

  const isDirty =
    apiKey.trim() !== savedKeyRef.current ||
    apiSecret.trim() !== savedSecretRef.current;
  const hasCreds = apiKey.trim().length > 0 && apiSecret.trim().length > 0;
  const canSave = isDirty && hasCreds;

  return (
    <div>
      <div className="page-header" style={{ position: 'relative' }}>
        <div>
          <h1 className="page-header__title">Profile</h1>
          <p className="page-header__subtitle">
            Manage your account and personal preferences
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
        <div className="profile-merged-card__left">
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
          {session && (
            <>
              <h3 className="card__title">Connected as {session.userName}</h3>
              <p className="card__description" style={{ marginBottom: 4 }}>
                User ID: {session.userId} &middot; {session.broker}
              </p>
              <p className="card__description" style={{ marginBottom: 16 }}>
                Session started: {session.loginTime}
              </p>
              {margins?.equity && (
                <div className="profile-funds">
                  <h4 className="profile-funds__title">Equity Funds</h4>
                  <div className="profile-funds__items">
                    <div className="profile-funds__row">
                      <span className="profile-funds__label">Available</span>
                      <span className="profile-funds__value">{margins.equity.available.live_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="profile-funds__row">
                      <span className="profile-funds__label">Used</span>
                      <span className="profile-funds__value">{margins.equity.utilised.debits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="profile-funds__row">
                      <span className="profile-funds__label">Collateral</span>
                      <span className="profile-funds__value">{margins.equity.available.collateral.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="profile-merged-card__divider" />

        <div className="profile-merged-card__right">
          <div className="card__icon">
            <IdCardIcon />
          </div>
          <h3 className="card__title">Account Details</h3>
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
          ) : (
            <p className="card__description">Loading account details...</p>
          )}
        </div>
      </div>

      {/* Security — Kite Connect Credentials */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card__icon">
          <ShieldIcon />
        </div>
        <h3 className="card__title">Security — Kite Connect</h3>
        <p className="card__description" style={{ marginBottom: 20 }}>
          Manage your Kite Connect API credentials. Get your keys from{' '}
          <a
            href="https://developers.kite.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-link"
          >
            developers.kite.trade
          </a>
        </p>

        <div className="settings-form">
          <div className="form-field">
            <label className="form-field__label" htmlFor="kite-api-key">
              API Key
            </label>
            <input
              id="kite-api-key"
              type="text"
              className="form-field__input"
              placeholder="Enter your Kite API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="form-field">
            <label className="form-field__label" htmlFor="kite-api-secret">
              API Secret
            </label>
            <div className="form-field__input-wrapper">
              <input
                id="kite-api-secret"
                type={showSecret ? 'text' : 'password'}
                className="form-field__input"
                placeholder="Enter your Kite API secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="form-field__toggle-visibility"
                onClick={() => setShowSecret((prev) => !prev)}
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="form-actions">
            <button
              className="btn btn--primary"
              onClick={handleSave}
              disabled={!canSave}
            >
              Save & Re-login
            </button>
            {isDirty && hasCreds && (
              <span className="form-actions__feedback" style={{ color: 'var(--text-secondary)' }}>
                Saving will log you out for a fresh login
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
