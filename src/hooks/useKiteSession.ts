import { useState, useEffect, useCallback, useRef } from 'react';
import { getSession, fetchAuthStatus, KiteSession, AuthStatus } from '@/services/kiteAuth';

const SESSION_EVENT = 'optiontrap_session_change';
const OPTIMISTIC_SESSION_GRACE_MS = 3000;

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
  const optimisticSessionRef = useRef<KiteSession | null>(null);
  const optimisticSessionUntilRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const status: AuthStatus = await fetchAuthStatus();
    const optimisticSession = Date.now() < optimisticSessionUntilRef.current
      ? optimisticSessionRef.current
      : null;
    setSession(status.session || optimisticSession);
    setCredentialsConfigured(status.credentialsConfigured);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    const handleChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== undefined) {
        optimisticSessionRef.current = event.detail;
        optimisticSessionUntilRef.current = event.detail
          ? Date.now() + OPTIMISTIC_SESSION_GRACE_MS
          : 0;
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
