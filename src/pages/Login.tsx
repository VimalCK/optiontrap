import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ParticleNetwork from '@/components/ParticleNetwork/ParticleNetwork';
import { getLoginUrl, getLastAvatarUrl, saveCredentials, hasCredentials, getCredentials } from '@/services/kiteAuth';
import { ShieldIcon } from '@/components/icons/Icons';
import '@/styles/login.css';

// ─── Login page ───────────────────────────────────────────────────────────────

const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  const existingCreds = getCredentials();
  const [apiKey, setApiKey] = useState(existingCreds?.apiKey ?? '');
  const [apiSecret, setApiSecret] = useState(existingCreds?.apiSecret ?? '');
  const [showSecret, setShowSecret] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const lastAvatar = getLastAvatarUrl();
    if (lastAvatar) setAvatarUrl(lastAvatar);

    // Check if localStorage already has credentials
    if (hasCredentials()) {
      setCredsSaved(true);
    }
  }, []);

  const handleSave = () => {
    setError(null);
    saveCredentials(apiKey.trim(), apiSecret.trim());
    setCredsSaved(true);
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setError(null);
    try {
      const url = await getLoginUrl();
      window.location.href = url;
    } catch {
      setError('Failed to get login URL. Is the server running?');
      setLoginLoading(false);
    }
  };

  const hasCreds = apiKey.trim().length > 0 && apiSecret.trim().length > 0;

  return (
    <div className="login-page">
      <ParticleNetwork />
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__icon">
            {avatarUrl
              ? <img src={avatarUrl} alt="Profile" className="login-card__avatar" />
              : <ShieldIcon size={30} />
            }
          </div>
          <h1 className="login-card__title">OptionTrap</h1>
          <p className="login-card__subtitle">Connect to Kite to start analysing</p>
        </div>

        <div className="login-card__body">
          {expired && (
            <div className="login-card__banner login-card__banner--expired">
              Session expired. Please login again.
            </div>
          )}

          {error && (
            <div className="login-card__banner login-card__banner--error">
              {error}
            </div>
          )}

          {credsSaved ? (
            <>
              <button
                className="btn btn--primary login-card__login-btn"
                onClick={handleLogin}
                disabled={loginLoading}
              >
                {loginLoading ? 'Redirecting...' : 'Login with Kite'}
              </button>
              <button
                className="login-card__change-creds"
                type="button"
                onClick={() => setCredsSaved(false)}
              >
                Change credentials
              </button>
            </>
          ) : (
            <div className="settings-form">
              <p className="login-card__status">
                Enter your Kite Connect API credentials.{' '}
                <a
                  href="https://developers.kite.trade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-link"
                >
                  Get keys
                </a>
              </p>
              <p className="login-card__privacy-note">
                Your API key and secret are stored only in this browser and are never saved on the server.
              </p>

              <div className="form-field">
                <label className="form-field__label" htmlFor="login-api-key">
                  API Key
                </label>
                <input
                  id="login-api-key"
                  type="text"
                  className="form-field__input"
                  placeholder="Enter your Kite API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="form-field">
                <label className="form-field__label" htmlFor="login-api-secret">
                  API Secret
                </label>
                <div className="form-field__input-wrapper">
                  <input
                    id="login-api-secret"
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
                  disabled={!hasCreds}
                >
                  Save & Continue
                </button>
              </div>
              {hasCredentials() && (
                <button
                  className="login-card__change-creds"
                  type="button"
                  onClick={() => setCredsSaved(true)}
                >
                  ← Back
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
