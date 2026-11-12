import { clearSession } from './kiteAuth';

export const AUTH_SESSION_EVENT = 'optiontrap_session_change';

/** Clear the cached session and notify the auth guard about an invalid Kite session. */
export function handleKiteAuthFailure(): void {
  clearSession();
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

