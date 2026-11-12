import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchQuotes } from './kiteQuotes.js';
import { KiteApiError } from './kiteClient.js';
import { KiteErrorType } from '../shared/tradeEnums.js';

const KITE = { apiKey: 'key', accessToken: 'token' };

/** Kite answers every quote request with `status` and `body`; returns the fetch mock. */
function kiteReplies(status, body) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchQuotes', () => {
  it('returns the quotes by key', async () => {
    kiteReplies(200, { status: 'success', data: { 'NSE:INFY': { last_price: 1500 } } });
    expect(await fetchQuotes(KITE, ['NSE:INFY'])).toEqual({ 'NSE:INFY': { last_price: 1500 } });
  });

  it("asks in batches of Kite's limit of 500 keys", async () => {
    const fetch = kiteReplies(200, { status: 'success', data: {} });
    await fetchQuotes(KITE, Array.from({ length: 501 }, (_, i) => `NSE:S${i}`));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('marks a lost login, so the job drops its cached session', async () => {
    kiteReplies(403, { status: 'error', message: 'Incorrect `api_key` or `access_token`.', error_type: KiteErrorType.TokenException });
    const err = await fetchQuotes(KITE, ['NSE:INFY']).catch((e) => e);
    expect(err).toBeInstanceOf(KiteApiError);
    expect(err.authFailure).toBe(true);
  });

  it('keeps the session when the app is not allowed quotes', async () => {
    kiteReplies(403, { status: 'error', message: 'Insufficient permission for that call.', error_type: KiteErrorType.PermissionException });
    const err = await fetchQuotes(KITE, ['NSE:INFY']).catch((e) => e);
    expect(err.authFailure).toBe(false);
    expect(err.message).toBe('Insufficient permission for that call.');
  });
});
