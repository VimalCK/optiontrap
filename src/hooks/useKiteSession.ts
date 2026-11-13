import { useState, useEffect, useCallback } from 'react';
import { getSession, fetchAuthStatus, KiteSession, AuthStatus } from '@/services/kiteAuth';
import { AUTH_SESSION_EVENT } from '@/services/authSession';

/** Call after login or logout so every mounted session hook reloads. */
export function notifySessionChange(): void {
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

/** Session state from /auth/status, reloaded on session change events. */
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
