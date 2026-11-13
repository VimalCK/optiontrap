/** The key comes from the browser, so it is encoded: a key holding `&`, `#` or `=` can't change Kite's login URL. */

const KITE_LOGIN_PAGE = 'https://kite.zerodha.com/connect/login';
const KITE_CONNECT_VERSION = '3';

/** `{ url }` for the API key from the query string, or `{ error }` when it is missing or repeated. */
export function kiteLoginUrl(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey) return { error: 'api_key query parameter is required' };
  const params = new URLSearchParams({ v: KITE_CONNECT_VERSION, api_key: apiKey });
  return { url: `${KITE_LOGIN_PAGE}?${params}` };
}
