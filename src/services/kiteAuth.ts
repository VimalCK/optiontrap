/**
 * Kite Authentication — Client-side module
 *
 * In this architecture, the backend server holds the apiSecret and accessToken.
 * The client never sees sensitive credentials. Session state is managed via
 * httpOnly cookies set by the server.
 *
 * The client only needs to:
 *  - Check auth status via GET /auth/status (credentials configured + session)
 *  - Save credentials via POST /auth/credentials (sent to server, stored server-side)
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

export interface AuthStatus {
  credentialsConfigured: boolean;
  authenticated: boolean;
  session: KiteSession | null;
}

// In-memory cache of session (avoids /auth/me on every render)
let cachedSession: KiteSession | null = null;
let cachedCredentialsConfigured: boolean = false;

/**
 * Check full auth status: credentials configured + session valid
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch('/auth/status', { credentials: 'include' });
    if (!res.ok) {
      cachedSession = null;
      cachedCredentialsConfigured = false;
      return { credentialsConfigured: false, authenticated: false, session: null };
    }
    const json = await res.json();
    cachedCredentialsConfigured = json.credentialsConfigured;
    if (json.authenticated && json.data) {
      cachedSession = json.data;
      if (json.data.avatarUrl) {
        localStorage.setItem(AVATAR_STORAGE_KEY, json.data.avatarUrl);
      }
    } else {
      cachedSession = null;
    }
    return {
      credentialsConfigured: json.credentialsConfigured,
      authenticated: json.authenticated,
      session: cachedSession,
    };
  } catch {
    cachedSession = null;
    cachedCredentialsConfigured = false;
    return { credentialsConfigured: false, authenticated: false, session: null };
  }
}

/**
 * Save API credentials to the server
 */
export async function saveCredentials(apiKey: string, apiSecret: string): Promise<void> {
  const res = await fetch('/auth/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ apiKey, apiSecret }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to save credentials' }));
    throw new Error(error.message);
  }
  cachedCredentialsConfigured = true;
}

/**
 * Check if credentials are configured (cached, synchronous)
 */
export function hasCredentials(): boolean {
  return cachedCredentialsConfigured;
}

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
 * Delete account — permanently removes credentials from server,
 * destroys session, and clears all cookies.
 */
export async function deleteAccount(): Promise<void> {
  await fetch('/auth/account', {
    method: 'DELETE',
    credentials: 'include',
  });
  cachedSession = null;
  cachedCredentialsConfigured = false;
  localStorage.removeItem(AVATAR_STORAGE_KEY);
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
