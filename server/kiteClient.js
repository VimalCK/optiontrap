/**
 * The server's one way to call Kite's REST API. A failed reply throws KiteApiError with Kite's status, error_type and
 * message, and `authFailure` from the one rule for a lost login (shared/kiteAuth.js).
 */
import { isKiteAuthFailure } from '../shared/kiteAuth.js';

export const KITE_API_URL = 'https://api.kite.trade';
const KITE_API_VERSION = '3';

/**
 * @typedef {{ apiKey: string, accessToken: string }} KiteLogin
 * @typedef {{ signal?: AbortSignal }} KiteCallOptions
 */

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
    this.kiteMessage = kiteMessage;
    /** Kite's error_type (shared/tradeEnums.js KiteErrorType), when its reply had one. */
    this.errorType = typeof body === 'object' && body !== null && 'error_type' in body ? String(body.error_type) : null;
    /** Whether the reply ended the login (shared/kiteAuth.js). */
    this.authFailure = isKiteAuthFailure(status, body);
  }
}

export function kiteHeaders(/** @type {KiteLogin | null} */ login = null) {
  /** @type {Record<string, string>} */
  const headers = { 'X-Kite-Version': KITE_API_VERSION };
  if (login) headers.Authorization = `token ${login.apiKey}:${login.accessToken}`;
  return headers;
}

async function errorBody(/** @type {Response} */ res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text || null;
  }
}

async function send(/** @type {string} */ path, /** @type {RequestInit} */ init) {
  const res = await fetch(`${KITE_API_URL}${path}`, init);
  if (!res.ok) throw new KiteApiError(res.status, await errorBody(res));
  return res;
}

/**
 * Paths start with `/` and carry their own query string.
 * @param {KiteLogin | null} [login]
 */
export function kiteClient(login = null) {
  const headers = kiteHeaders(login);
  return {
    async get(/** @type {string} */ path, /** @type {KiteCallOptions} */ { signal } = {}) {
      const res = await send(path, { headers, signal });
      return (await res.json())?.data;
    },

    async getText(/** @type {string} */ path, /** @type {KiteCallOptions} */ { signal } = {}) {
      const res = await send(path, { headers, signal });
      return res.text();
    },

    async postForm(/** @type {string} */ path, /** @type {Record<string, string>} */ form) {
      const res = await send(path, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
      return (await res.json())?.data;
    },

    async delete(/** @type {string} */ path) {
      await send(path, { method: 'DELETE', headers });
    },
  };
}
