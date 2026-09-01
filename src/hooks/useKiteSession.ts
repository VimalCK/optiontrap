import { useState, useEffect, useCallback } from 'react';
import { getSession, fetchAuthStatus, KiteSession, AuthStatus } from '@/services/kiteAuth';

const SESSION_EVENT = 'optiontrap_session_change';

/**
 * Dispatch this after login/logout to notify all listeners
 */
export function notifySessionChange(session?: KiteSession | null): void {
  window.dispatchEvent(new CustomEvent<KiteSession | null | undefined>(SESSION_EVENT, { detail: session }));
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

    const handleChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== undefined) {
        setSession(event.detail);
        setCredentialsConfigured(true);
        setLoading(false);
      }
      refresh();
    };
    window.addEventListener(SESSION_EVENT, handleChange as EventListener);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(SESSION_EVENT, handleChange as EventListener);
      window.removeEventListener('storage', handleChange);
    };
  }, [refresh]);

  return { session, loading, credentialsConfigured };
}
