import React, { useState, useEffect } from 'react';
import Modal from '@/components/Modal/Modal';
import Message from '@/components/Message/Message';
import { ShieldIcon } from '@/components/icons/Icons';
import { getLoginUrl, getLastAvatarUrl, saveCredentials, getCredentials } from '@/services/kiteAuth';
import { MessageTone, ModalSize } from '@/utils/uiEnums';

// The redirect URL that must be registered in the user's Kite Connect app.
const REDIRECT_URL = 'https://optiontrap.com/redirect';

interface KiteLoginModalProps {
  /** Whether this browser holds Kite credentials: then the popup offers the login, else the form. */
  credsSaved: boolean;
  onCredsSavedChange: (saved: boolean) => void;
  onClose: () => void;
}

/** The login popup: the Kite Connect credentials form, then the redirect to Kite. */
const KiteLoginModal: React.FC<KiteLoginModalProps> = ({ credsSaved, onCredsSavedChange, onClose }) => {
  const existingCreds = getCredentials();
  const [apiKey, setApiKey] = useState(existingCreds?.apiKey ?? '');
  const [apiSecret, setApiSecret] = useState(existingCreds?.apiSecret ?? '');
  const [showSecret, setShowSecret] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const lastAvatar = getLastAvatarUrl();
    if (lastAvatar) setAvatarUrl(lastAvatar);
  }, []);

  const copyRedirect = () => {
    navigator.clipboard?.writeText(REDIRECT_URL).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* clipboard unavailable — ignore */ },
    );
  };

  const handleSave = () => {
    setError(null);
    saveCredentials(apiKey.trim(), apiSecret.trim());
    onCredsSavedChange(true);
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
    <Modal
      title={credsSaved ? 'Welcome back' : 'Connect your Kite account'}
      subtitle={credsSaved
        ? 'Continue to Kite to authorise this session.'
        : 'OptionTrap connects to your Zerodha account using Kite Connect.'}
      leading={(
        <div className="auth-modal__icon">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <ShieldIcon size={22} />}
        </div>
      )}
      size={ModalSize.Medium}
      onClose={onClose}
    >
      {error && <Message tone={MessageTone.Error} className="auth-modal__error">{error}</Message>}

      {credsSaved ? (
        <>
          <button className="auth-modal__primary" onClick={handleLogin} disabled={loginLoading}>
            {loginLoading ? 'Redirecting...' : 'Login with Kite'}
          </button>
          <button className="auth-modal__link" type="button" onClick={() => onCredsSavedChange(false)}>
            Change credentials
          </button>
        </>
      ) : (
        <div className="auth-form">
          <p className="auth-form__hint">
            Enter your Kite Connect API credentials.{' '}
            <a href="https://developers.kite.trade" target="_blank" rel="noopener noreferrer">Get keys</a>
          </p>

          <div className="auth-form__redirect">
            <span className="auth-form__redirect-label">In your Kite app, set the Redirect URL to</span>
            <div className="auth-form__redirect-row">
              <code>{REDIRECT_URL}</code>
              <button type="button" className="auth-form__copy" onClick={copyRedirect}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="form-field">
            <label className="form-field__label" htmlFor="login-api-key">API Key</label>
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
            <label className="form-field__label" htmlFor="login-api-secret">API Secret</label>
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

          <p className="auth-form__privacy">
            Stored only in this browser. Never sent to our servers for storage.
          </p>

          <button className="auth-modal__primary" onClick={handleSave} disabled={!hasCreds}>
            Save &amp; Continue
          </button>
        </div>
      )}
    </Modal>
  );
};

export default KiteLoginModal;
