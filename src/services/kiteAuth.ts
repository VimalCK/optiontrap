/**
 * Kite Authentication — Client-side module
 *
 * Credentials (apiKey + apiSecret) are stored ONLY in browser localStorage.
 * The server never persists them — they are sent during OAuth token exchange
 * and immediately discarded. Session state is managed via httpOnly cookies.
 */

const AVATAR_STORAGE_KEY = 'optiontrap_avatar_url';
const CREDS_KEY = 'optiontrap_credentials';

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

/**
 * Check full auth status: credentials configured (localStorage) + session valid (server)
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const hasCreds = hasCredentials();
  try {
    const res = await fetch('/auth/status', { credentials: 'include' });
    if (!res.ok) {
      cachedSession = null;
      return { credentialsConfigured: hasCreds, authenticated: false, session: null };
    }
    const json = await res.json();
    if (json.authenticated && json.data) {
      cachedSession = json.data;
      if (json.data.avatarUrl) {
        localStorage.setItem(AVATAR_STORAGE_KEY, json.data.avatarUrl);
      }
    } else {
      cachedSession = null;
    }
    return {
      credentialsConfigured: hasCreds,
      authenticated: json.authenticated,
      session: cachedSession,
    };
  } catch {
    cachedSession = null;
    return { credentialsConfigured: hasCreds, authenticated: false, session: null };
  }
}

/**
 * Save API credentials to browser localStorage (never sent to server for storage)
 */
export function saveCredentials(apiKey: string, apiSecret: string): void {
  localStorage.setItem(CREDS_KEY, JSON.stringify({ apiKey, apiSecret }));
}

/**
 * Get saved credentials from localStorage
 */
export function getCredentials(): { apiKey: string; apiSecret: string } | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.apiKey && parsed.apiSecret) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear credentials from localStorage
 */
export function clearCredentials(): void {
  localStorage.removeItem(CREDS_KEY);
}

/**
 * Check if credentials are configured (synchronous, checks localStorage)
 */
export function hasCredentials(): boolean {
  return getCredentials() !== null;
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
  const creds = getCredentials();
  if (!creds) throw new Error('No credentials configured');

  const res = await fetch(`/auth/login-url?api_key=${encodeURIComponent(creds.apiKey)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to get login URL' }));
    throw new Error(error.message);
  }
  const { url } = await res.json();
  return url;
}

/**
 * Exchange request_token for session (server does SHA-256 + Kite exchange)
 * Credentials are sent from localStorage — server uses them once and discards.
 */
export async function exchangeToken(requestToken: string): Promise<KiteSession> {
  const creds = getCredentials();
  if (!creds) throw new Error('No credentials configured');

  const res = await fetch('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      request_token: requestToken,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[kiteAuth] Token exchange failed:', res.status, text);
    let message = `Token exchange failed (${res.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.message) message = parsed.message;
    } catch { /* response wasn't JSON */ }
    throw new Error(message);
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
 * Delete account — removes user from server, clears localStorage credentials.
 */
export async function deleteAccount(): Promise<void> {
  await fetch('/auth/account', {
    method: 'DELETE',
    credentials: 'include',
  });
  cachedSession = null;
  clearCredentials();
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
