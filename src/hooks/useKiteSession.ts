import { useState, useEffect, useCallback } from 'react';
import { getSession, fetchAuthStatus, KiteSession, AuthStatus } from '@/services/kiteAuth';
import { AUTH_SESSION_EVENT } from '@/services/authSession';

/**
 * Dispatch this after login/logout to notify all listeners
 */
export function notifySessionChange(): void {
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

/**
 * Hook that reactively tracks the Kite session state.
 * On mount, calls /auth/status to check credentials + session.
 * Listens for session change events to re-fetch.
 */
export function useKiteSession(): { session: KiteSession | null; loading: boolean; credentialsConfigured: boolean } {
  const [session, setSession] = useState<KiteSession | null>(getSession);
  const [loading, setLoading] = useState(true);
  const [credentialsConfigured, setCredentialsConfigured] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const status: AuthStatus = await fetchAuthStatus();
    setSession(status.session);
    setCredentialsConfigured(status.credentialsConfigured);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    const handleChange = () => { refresh(); };
    window.addEventListener(AUTH_SESSION_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(AUTH_SESSION_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, [refresh]);

  return { session, loading, credentialsConfigured };
}
