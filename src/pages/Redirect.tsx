import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { exchangeToken } from '@/services/kiteAuth';
import { notifySessionChange } from '@/hooks/useKiteSession';

// Module-level guard — survives React StrictMode unmount-remount cycle
let exchangedToken: string | null = null;

const Redirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requestToken = searchParams.get('request_token');

    // Prevent double execution: skip if we already exchanged this exact token
    if (exchangedToken === requestToken) return;
    exchangedToken = requestToken;

    const status = searchParams.get('status');

    if (status === 'error' || !requestToken) {
      setError('Login failed or was cancelled. Please try again.');
      return;
    }

    exchangeToken(requestToken)
      .then(() => {
        notifySessionChange();
        navigate('/portfolio', { replace: true });
      })
      .catch((err) => {
        console.error('[Redirect] Token exchange error:', err);
        setError(err.message || 'Failed to complete authentication.');
      });
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="redirect-page">
        <div className="redirect-card redirect-card--error">
          <div className="redirect-icon">✕</div>
          <h2>Authentication Failed</h2>
          <p>{error}</p>
          <button className="btn btn--primary" onClick={() => navigate('/login')}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="redirect-page">
      <div className="redirect-card">
        <div className="redirect-spinner" />
        <h2>Authenticating...</h2>
        <p>Completing login with Kite Connect</p>
      </div>
    </div>
  );
};

export default Redirect;
