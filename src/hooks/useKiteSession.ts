import { useState, useEffect, useCallback } from 'react';
import { getSession, fetchSession, KiteSession } from '@/services/kiteAuth';

const SESSION_EVENT = 'optiontrap_session_change';

/**
 * Dispatch this after login/logout to notify all listeners
 */
export function notifySessionChange(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/**
 * Hook that reactively tracks the Kite session state.
 * On mount, fetches session from server (validates cookie).
 * Listens for session change events to re-fetch.
 */
export function useKiteSession(): { session: KiteSession | null; loading: boolean } {
  const [session, setSession] = useState<KiteSession | null>(getSession);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await fetchSession();
    setSession(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial fetch on mount
    refresh();

    const handleChange = () => { refresh(); };
    window.addEventListener(SESSION_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(SESSION_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, [refresh]);

  return { session, loading };
}
