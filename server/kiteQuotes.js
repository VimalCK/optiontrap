/**
 * Kite quotes for server jobs (the OI snapshots, the trade engine), with an
 * admin Kite session: GET /quote in batches of Kite's limit, keyed
 * EXCHANGE:TRADINGSYMBOL. A 401/403 throws KiteAuthError, so a job can drop
 * the session it cached and look for a working one next time.
 */

const QUOTE_BATCH = 500; // Kite's limit per /quote request

/** Kite refused the session (expired or revoked). */
export class KiteAuthError extends Error {}

/**
 * Full quotes for `keys` ('NFO:NIFTY26NOV24000PE'), as Kite returns them, by key.
 * @param {{ apiKey: string, accessToken: string }} kite
 * @param {string[]} keys
 * @returns {Promise<Record<string, any>>}
 */
export async function fetchQuotes(kite, keys) {
  /** @type {Record<string, any>} */
  const quotes = {};
  for (let i = 0; i < keys.length; i += QUOTE_BATCH) {
    const qs = keys.slice(i, i + QUOTE_BATCH).map((k) => `i=${encodeURIComponent(k)}`).join('&');
    const res = await fetch(`https://api.kite.trade/quote?${qs}`, {
      headers: { Authorization: `token ${kite.apiKey}:${kite.accessToken}`, 'X-Kite-Version': '3' },
    });
    if (res.status === 401 || res.status === 403) throw new KiteAuthError(`Kite quote auth failed (${res.status})`);
    if (!res.ok) throw new Error(`Kite quote failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    Object.assign(quotes, body.data || {});
  }
  return quotes;
}
