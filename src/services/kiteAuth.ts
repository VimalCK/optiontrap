/**
 * Kite Authentication — Client-side module
 *
 * In this architecture, the backend server holds the apiSecret and accessToken.
 * The client never sees sensitive credentials. Session state is managed via
 * httpOnly cookies set by the server.
 *
 * The client only needs to:
 *  - Check session status via GET /auth/me
 *  - Get login URL via GET /auth/login-url
 *  - Exchange request_token via POST /auth/token (server does SHA-256 + exchange)
 *  - Logout via POST /auth/logout
 */

const AVATAR_STORAGE_KEY = 'optiontrap_avatar_url';

export interface KiteSession {
  userId: string;
  userName: string;
  userShortname: string;
  email: string;
  broker: string;
  loginTime: string;
  avatarUrl: string | null;
}

// In-memory cache of session (avoids /auth/me on every render)
let cachedSession: KiteSession | null = null;

/**
 * Check if we have a valid session (calls server)
 */
export async function fetchSession(): Promise<KiteSession | null> {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) {
      cachedSession = null;
      return null;
    }
    const { data } = await res.json();
    cachedSession = data;
    if (data.avatarUrl) {
      localStorage.setItem(AVATAR_STORAGE_KEY, data.avatarUrl);
    }
    return data;
  } catch {
    cachedSession = null;
    return null;
  }
}

/**
 * Get cached session (synchronous — may be null if not yet fetched)
 */
export function getSession(): KiteSession | null {
  return cachedSession;
}

/**
 * Set cached session locally (called after token exchange)
 */
export function setCachedSession(session: KiteSession | null): void {
  cachedSession = session;
}

/**
 * Clear cached session (called on 401/logout)
 */
export function clearSession(): void {
  cachedSession = null;
}

/**
 * Get Kite OAuth login URL from server
 */
export async function getLoginUrl(): Promise<string> {
  const res = await fetch('/auth/login-url', { credentials: 'include' });
  const { url } = await res.json();
  return url;
}

/**
 * Exchange request_token for session (server does the heavy lifting)
 */
export async function exchangeToken(requestToken: string): Promise<KiteSession> {
  const res = await fetch('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ request_token: requestToken }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Token exchange failed' }));
    throw new Error(error.message || `Token exchange failed (${res.status})`);
  }

  const { data } = await res.json();
  cachedSession = data;
  if (data.avatarUrl) {
    localStorage.setItem(AVATAR_STORAGE_KEY, data.avatarUrl);
  }
  return data;
}

/**
 * Logout — server invalidates session + clears cookie
 */
export async function logout(): Promise<void> {
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignore network errors on logout
  }
  cachedSession = null;
}

/**
 * Get last known avatar URL (persisted across sessions for login page)
 */
export function getLastAvatarUrl(): string | null {
  return localStorage.getItem(AVATAR_STORAGE_KEY);
}

/**
 * Clear stored avatar URL
 */
export function clearLastAvatarUrl(): void {
  localStorage.removeItem(AVATAR_STORAGE_KEY);
}
