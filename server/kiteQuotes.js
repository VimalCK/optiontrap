/**
 * GET /quote in batches of Kite's limit, keyed EXCHANGE:TRADINGSYMBOL. A failure with `authFailure` lets a job drop
 * the session it cached and look for a working one next time.
 */
import { kiteClient } from './kiteClient.js';

const QUOTE_BATCH = 500; // Kite's limit per /quote request

/**
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
