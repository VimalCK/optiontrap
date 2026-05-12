import { useState, useEffect, useCallback } from 'react';
import { getSession, KiteSession } from '@/services/kiteAuth';

const SESSION_EVENT = 'optiontrap_session_change';

/**
 * Dispatch this after login/logout to notify all listeners
 */
export function notifySessionChange(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/**
 * Hook that reactively tracks the Kite session state
 */
export function useKiteSession(): KiteSession | null {
  const [session, setSession] = useState<KiteSession | null>(getSession);

  const refresh = useCallback(() => {
    setSession(getSession());
  }, []);

  useEffect(() => {
    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  return session;
}
