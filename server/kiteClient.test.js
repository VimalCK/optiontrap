import { describe, it, expect, vi, afterEach } from 'vitest';
import { KITE_API_URL, KiteApiError, kiteClient, kiteHeaders } from './kiteClient.js';
import { KiteErrorType } from '../shared/tradeEnums.js';

const LOGIN = { apiKey: 'key', accessToken: 'token' };
const TOKEN_ERROR = { status: 'error', message: 'Incorrect `api_key` or `access_token`.', error_type: KiteErrorType.TokenException };
const PERMISSION_ERROR = { status: 'error', message: 'Insufficient permission for that call.', error_type: KiteErrorType.PermissionException };

/** Kite answers every call with `body` (JSON unless a string) and `status`; returns the fetch mock. */
function kiteReplies(status, body) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const failure = (promise) => promise.then(() => { throw new Error('expected a failure'); }, (err) => err);

afterEach(() => vi.unstubAllGlobals());

describe('kiteHeaders', () => {
  it('always names the API version, and the login when there is one', () => {
    expect(kiteHeaders()).toEqual({ 'X-Kite-Version': '3' });
    expect(kiteHeaders(LOGIN)).toEqual({ 'X-Kite-Version': '3', Authorization: 'token key:token' });
  });
});

describe('kiteClient', () => {
  it("GETs a path on Kite's API with the login headers and returns its data", async () => {
    const fetch = kiteReplies(200, { status: 'success', data: { candles: [[1]] } });
    const signal = new AbortController().signal;
    expect(await kiteClient(LOGIN).get('/instruments/historical/1/day?from=a&to=b', { signal })).toEqual({ candles: [[1]] });
    expect(fetch).toHaveBeenCalledWith(`${KITE_API_URL}/instruments/historical/1/day?from=a&to=b`, { headers: kiteHeaders(LOGIN), signal });
  });

  it('GETs a text endpoint as text', async () => {
    kiteReplies(200, 'instrument_token,tradingsymbol\n1,INFY');
    expect(await kiteClient(LOGIN).getText('/instruments/NSE')).toBe('instrument_token,tradingsymbol\n1,INFY');
  });

  it('POSTs a form without a login, for the token exchange', async () => {
    const fetch = kiteReplies(200, { status: 'success', data: { access_token: 'new' } });
    expect(await kiteClient().postForm('/session/token', { api_key: 'key', checksum: 'abc' })).toEqual({ access_token: 'new' });
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(String(init.body)).toBe('api_key=key&checksum=abc');
  });

  it('DELETEs with the login', async () => {
    const fetch = kiteReplies(200, { status: 'success', data: true });
    await kiteClient(LOGIN).delete('/session/token');
    expect(fetch).toHaveBeenCalledWith(`${KITE_API_URL}/session/token`, { method: 'DELETE', headers: kiteHeaders(LOGIN) });
  });

  it("throws KiteApiError with Kite's status, message and error type, marking a lost login", async () => {
    kiteReplies(403, TOKEN_ERROR);
    const err = await failure(kiteClient(LOGIN).get('/quote?i=NSE:INFY'));
    expect(err).toBeInstanceOf(KiteApiError);
    expect(err).toMatchObject({ status: 403, message: TOKEN_ERROR.message, kiteMessage: TOKEN_ERROR.message, errorType: KiteErrorType.TokenException, authFailure: true });
  });

  it('does not mark a call the app is not allowed as a lost login', async () => {
    kiteReplies(403, PERMISSION_ERROR);
    const err = await failure(kiteClient(LOGIN).get('/quote?i=NSE:INFY'));
    expect(err).toMatchObject({ status: 403, errorType: KiteErrorType.PermissionException, authFailure: false });
  });

  it('names the status when the failure has no JSON body', async () => {
    kiteReplies(502, 'Bad gateway');
    const err = await failure(kiteClient(LOGIN).get('/quote?i=NSE:INFY'));
    expect(err).toMatchObject({ status: 502, message: 'Kite answered 502', kiteMessage: null, errorType: null, authFailure: false });
  });
});
