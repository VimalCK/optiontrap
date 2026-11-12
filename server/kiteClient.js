/**
 * The server's one way to call Kite's REST API (api.kite.trade): the base
 * URL, the version header, the `token api_key:access_token` login header,
 * reading the reply and turning a failure into a KiteApiError live here, so
 * no caller writes them out. Used by login and logout (server/index.js), Kite
 * quotes, OI history, stock candles, the instrument list and the admin
 * session check. The browser's own calls go through the server's Kite proxy,
 * which signs them with the same headers (kiteHeaders).
 *
 * A failed reply throws KiteApiError with Kite's status, its error_type and
 * message when the body has them, and `authFailure` from the one rule for a
 * lost login (shared/kiteAuth.js).
 */
import { isKiteAuthFailure } from '../shared/kiteAuth.js';

export const KITE_API_URL = 'https://api.kite.trade';
const KITE_API_VERSION = '3';

/**
 * @typedef {{ apiKey: string, accessToken: string }} KiteLogin
 * @typedef {{ signal?: AbortSignal }} KiteCallOptions
 */

/** A failed Kite reply. */
export class KiteApiError extends Error {
  /**
   * @param {number} status        Kite's HTTP status
   * @param {unknown} body         the reply's body: Kite's JSON error, its text, or null
   */
  constructor(status, body) {
    const kiteMessage = typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : null;
    super(kiteMessage ?? `Kite answered ${status}`);
    this.name = 'KiteApiError';
    this.status = status;
    /** Kite's own message, when its reply had one. */
    this.kiteMessage = kiteMessage;
    /** Kite's error_type (shared/tradeEnums.js KiteErrorType), when its reply had one. */
    this.errorType = typeof body === 'object' && body !== null && 'error_type' in body ? String(body.error_type) : null;
    /** Whether the reply ended the login (shared/kiteAuth.js). */
    this.authFailure = isKiteAuthFailure(status, body);
  }
}

/** Kite's request headers: the API version, and the login when there is one. */
export function kiteHeaders(/** @type {KiteLogin | null} */ login = null) {
  /** @type {Record<string, string>} */
  const headers = { 'X-Kite-Version': KITE_API_VERSION };
  if (login) headers.Authorization = `token ${login.apiKey}:${login.accessToken}`;
  return headers;
}

/** A failed reply's body: its JSON when it is JSON, else its text, else null. */
async function errorBody(/** @type {Response} */ res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text || null;
  }
}

/** Send one request; throws KiteApiError unless Kite answered 2xx. */
async function send(/** @type {string} */ path, /** @type {RequestInit} */ init) {
  const res = await fetch(`${KITE_API_URL}${path}`, init);
  if (!res.ok) throw new KiteApiError(res.status, await errorBody(res));
  return res;
}

/**
 * A Kite client for one login, or for none (the token exchange at login).
 * Paths start with `/` and carry their own query string.
 * @param {KiteLogin | null} [login]
 */
export function kiteClient(login = null) {
  const headers = kiteHeaders(login);
  return {
    /** GET a JSON endpoint; returns its `data`. */
    async get(/** @type {string} */ path, /** @type {KiteCallOptions} */ { signal } = {}) {
      const res = await send(path, { headers, signal });
      return (await res.json())?.data;
    },

    /** GET a text endpoint (the instrument list CSV). */
    async getText(/** @type {string} */ path, /** @type {KiteCallOptions} */ { signal } = {}) {
      const res = await send(path, { headers, signal });
      return res.text();
    },

    /** POST a form; returns the reply's `data`. */
    async postForm(/** @type {string} */ path, /** @type {Record<string, string>} */ form) {
      const res = await send(path, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
      return (await res.json())?.data;
    },

    /** DELETE a resource (the session token at logout). */
    async delete(/** @type {string} */ path) {
      await send(path, { method: 'DELETE', headers });
    },
  };
}
