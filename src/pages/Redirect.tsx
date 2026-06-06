import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { exchangeToken } from '@/services/kiteAuth';
import { notifySessionChange } from '@/hooks/useKiteSession';

const Redirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const exchangedRef = useRef(false);

  useEffect(() => {
    // Prevent double execution in React StrictMode
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const requestToken = searchParams.get('request_token');
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
