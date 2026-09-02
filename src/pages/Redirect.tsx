import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { exchangeToken } from '@/services/kiteAuth';
import { notifySessionChange } from '@/hooks/useKiteSession';

const Redirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requestToken = searchParams.get('request_token');
    const status = searchParams.get('status');

    if (status === 'error' || !requestToken) {
      setError('Login failed or was cancelled. Please try again.');
      return;
    }

    exchangeToken(requestToken)
      .then(() => {
        notifySessionChange();
        navigate('/subscribe', { replace: true });
      })
      .catch((err) => {
        console.error('[Redirect] Token exchange error, retrying...', err);
        // Retry once after a short delay (handles stale session race)
        setTimeout(() => {
          exchangeToken(requestToken)
            .then(() => {
              notifySessionChange();
              navigate('/subscribe', { replace: true });
            })
            .catch((retryErr) => {
              console.error('[Redirect] Retry failed:', retryErr);
              setError(retryErr.message || 'Failed to complete authentication.');
            });
        }, 1000);
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
