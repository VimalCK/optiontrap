import { clearSession } from './kiteAuth';

export const AUTH_SESSION_EVENT = 'optiontrap_session_change';

const AUTH_FAILURE_PATTERN = /incorrect [`']?api_key or access_token|tokenexception|invalid.*(?:session|token)|session.*expired|token.*expired|expired.*token/i;

export function isKiteAuthFailure(message: string): boolean {
  return AUTH_FAILURE_PATTERN.test(message);
}

/** Clear the cached session and notify the auth guard about an invalid Kite session. */
export function handleKiteAuthFailure(): void {
  clearSession();
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

