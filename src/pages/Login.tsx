import React, { useState, useEffect } from 'react';
import { getCredentials, getLoginUrl } from '@/services/kiteAuth';
import { ShieldIcon } from '@/components/icons/Icons';
import '@/styles/login.css';

const KITE_STORAGE_KEY = 'optiontrap_kite_credentials';

interface Credentials {
  apiKey: string;
  apiSecret: string;
}

const Login: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasStoredCreds, setHasStoredCreds] = useState(false);

  useEffect(() => {
    const creds = getCredentials();
    if (creds) {
      setApiKey(creds.apiKey);
      setApiSecret(creds.apiSecret);
      setHasStoredCreds(true);
    }
  }, []);

  const handleSave = () => {
    const credentials: Credentials = { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
    localStorage.setItem(KITE_STORAGE_KEY, JSON.stringify(credentials));
    setHasStoredCreds(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleLogin = () => {
    const url = getLoginUrl();
    if (url) {
      window.location.href = url;
    }
  };

  const hasCreds = apiKey.trim().length > 0 && apiSecret.trim().length > 0;

  const BG_EMOJIS = [
    { emoji: '📈', top: '8%',  left: '6%',  size: 28, rot: -12 },
    { emoji: '💹', top: '14%', left: '82%', size: 22, rot: 8 },
    { emoji: '📊', top: '32%', left: '91%', size: 26, rot: 14 },
    { emoji: '💰', top: '58%', left: '88%', size: 24, rot: -6 },
    { emoji: '🪙', top: '76%', left: '78%', size: 20, rot: 10 },
    { emoji: '📉', top: '88%', left: '60%', size: 26, rot: -8 },
    { emoji: '🏦', top: '85%', left: '12%', size: 22, rot: 6 },
    { emoji: '💵', top: '68%', left: '5%',  size: 20, rot: -14 },
    { emoji: '⚡', top: '48%', left: '3%',  size: 18, rot: 4 },
    { emoji: '🔔', top: '22%', left: '14%', size: 20, rot: -10 },
    { emoji: '📋', top: '5%',  left: '55%', size: 18, rot: 7 },
    { emoji: '💎', top: '40%', left: '94%', size: 20, rot: -5 },
  ];

  return (
    <div className="login-page">
      <div className="login-bg-emojis" aria-hidden="true">
        {BG_EMOJIS.map((e, i) => (
          <span
            key={i}
            className="login-bg-emoji"
            style={{
              top: e.top,
              left: e.left,
              fontSize: e.size,
              transform: `rotate(${e.rot}deg)`,
              animationDelay: `${(i * 0.7) % 4}s`,
            }}
          >
            {e.emoji}
          </span>
        ))}
      </div>
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__icon">
            <ShieldIcon />
          </div>
          <h1 className="login-card__title">OptionTrap</h1>
          <p className="login-card__subtitle">Connect to Kite to start analysing</p>
        </div>

        {hasStoredCreds ? (
          <div className="login-card__body">
            <p className="login-card__status">API credentials configured.</p>
            <button className="btn btn--primary login-card__login-btn" onClick={handleLogin}>
              Login with Kite
            </button>
            <button
              className="login-card__change-creds"
              type="button"
              onClick={() => setHasStoredCreds(false)}
            >
              Change credentials
            </button>
          </div>
        ) : (
          <div className="login-card__body">
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

            <div className="settings-form">
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
                  {saved ? 'Saved' : 'Save & Continue'}
                </button>
                {saved && (
                  <span className="form-actions__feedback">
                    Credentials saved
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
