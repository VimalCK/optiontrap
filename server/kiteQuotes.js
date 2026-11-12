/**
 * Kite quotes for server jobs (the OI snapshots, the trade engine), with an
 * admin Kite session: GET /quote in batches of Kite's limit, keyed
 * EXCHANGE:TRADINGSYMBOL, through the Kite client (server/kiteClient.js). A
 * failure throws its KiteApiError; one with `authFailure` lets a job drop the
 * session it cached and look for a working one next time.
 */
import { kiteClient } from './kiteClient.js';

const QUOTE_BATCH = 500; // Kite's limit per /quote request

/**
 * Full quotes for `keys` ('NFO:NIFTY26NOV24000PE'), as Kite returns them, by key.
 * @param {{ apiKey: string, accessToken: string }} kite
 * @param {string[]} keys
 * @returns {Promise<Record<string, any>>}
 */
export async function fetchQuotes(kite, keys) {
  const client = kiteClient(kite);
  /** @type {Record<string, any>} */
  const quotes = {};
  for (let i = 0; i < keys.length; i += QUOTE_BATCH) {
    const qs = keys.slice(i, i + QUOTE_BATCH).map((k) => `i=${encodeURIComponent(k)}`).join('&');
    Object.assign(quotes, (await client.get(`/quote?${qs}`)) || {});
  }
  return quotes;
}
