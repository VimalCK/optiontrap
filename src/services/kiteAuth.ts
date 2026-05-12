const KITE_STORAGE_KEY = 'optiontrap_kite_credentials';
const SESSION_STORAGE_KEY = 'optiontrap_kite_session';

export interface KiteCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface KiteSession {
  accessToken: string;
  userId: string;
  userName: string;
  userShortname: string;
  email: string;
  broker: string;
  loginTime: string;
  avatarUrl: string | null;
}

export function getCredentials(): KiteCredentials | null {
  const stored = localStorage.getItem(KITE_STORAGE_KEY);
  if (!stored) return null;
  const parsed = JSON.parse(stored);
  if (!parsed.apiKey || !parsed.apiSecret) return null;
  return parsed;
}

export function getSession(): KiteSession | null {
  const stored = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) return null;
  return JSON.parse(stored);
}

export function saveSession(session: KiteSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getLoginUrl(): string | null {
  const creds = getCredentials();
  if (!creds) return null;
  return `https://kite.zerodha.com/connect/login?v=3&api_key=${creds.apiKey}`;
}

/**
 * Compute SHA-256 checksum of api_key + request_token + api_secret
 */
async function computeChecksum(apiKey: string, requestToken: string, apiSecret: string): Promise<string> {
  const data = apiKey + requestToken + apiSecret;
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Exchange request_token for access_token
 */
export async function exchangeToken(requestToken: string): Promise<KiteSession> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('Kite API credentials not configured. Go to Profile to set them up.');
  }

  const checksum = await computeChecksum(creds.apiKey, requestToken, creds.apiSecret);

  const response = await fetch('/api/session/token', {
    method: 'POST',
    headers: {
      'X-Kite-Version': '3',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      api_key: creds.apiKey,
      request_token: requestToken,
      checksum,
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    let errorBody = null;
    try {
      errorBody = JSON.parse(rawText);
    } catch {
      // Not JSON
    }
    console.error('[KiteAuth] Token exchange error:', response.status, rawText);
    const message = errorBody?.message || errorBody?.error_type || `Token exchange failed (${response.status}): ${rawText}`;
    throw new Error(message);
  }

  const result = await response.json();
  const data = result.data;

  const session: KiteSession = {
    accessToken: data.access_token,
    userId: data.user_id,
    userName: data.user_name,
    userShortname: data.user_shortname,
    email: data.email,
    broker: data.broker,
    loginTime: data.login_time,
    avatarUrl: data.avatar_url || null,
  };

  saveSession(session);
  return session;
}

/**
 * Logout — invalidate the session
 */
export async function logout(): Promise<void> {
  const creds = getCredentials();
  const session = getSession();

  if (creds && session) {
    await fetch(
      `/api/session/token?api_key=${creds.apiKey}&access_token=${session.accessToken}`,
      {
        method: 'DELETE',
        headers: { 'X-Kite-Version': '3' },
      },
    ).catch(() => {
      // Ignore network errors on logout
    });
  }

  clearSession();
}

/**
 * Get authorization header value for API requests.
 * Use with fetch('/api/...', { headers: { Authorization: getAuthHeader() } })
 */
export function getAuthHeader(): string | null {
  const creds = getCredentials();
  const session = getSession();
  if (!creds || !session) return null;
  return `token ${creds.apiKey}:${session.accessToken}`;
}
