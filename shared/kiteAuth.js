/**
 * The one rule for "did Kite refuse the login?", used wherever a Kite reply
 * (or our server's reply to the browser) can mean the login has ended:
 *   server  the Kite REST proxy and WebSocket proxy (server/index.js), the
 *           server's ticker feed (server/kiteTickerFeed.js), Kite quotes
 *           (server/kiteQuotes.js) and the after-close Kite jobs
 *           (server/dailyKiteJob.js)
 *   browser apiClient (src/services/apiClient.ts), which sends the user to login,
 *           and the OI History fetch's event stream (KITE_LOGIN_ENDED)
 *
 * A 401 always ends the login. Kite answers 403 for two different things: an
 * expired or revoked login (TokenException) and a call this Kite app isn't
 * allowed to make (PermissionException, e.g. quotes without market-data
 * access); only the first ends it. Without the reply's body (a WebSocket
 * handshake, or an error that kept only the status), every 403 counts.
 */
import { KiteErrorType } from './tradeEnums.js';

/**
 * The reply code for "your Kite login has ended" where a reply can't use the
 * HTTP status (the OI History fetch's event stream), so the browser sends the
 * user to login instead of showing an error.
 */
export const KITE_LOGIN_ENDED = 'KITE_LOGIN_ENDED';

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

/** Whether a body is Kite's "not allowed for this app" error, which leaves the login alone. */
const isPermissionError = (/** @type {unknown} */ body) =>
  typeof body === 'object' && body !== null && 'error_type' in body && body.error_type === KiteErrorType.PermissionException;

/**
 * Whether an HTTP status (and the reply's body, when known) means the Kite login is no longer valid.
 * @param {number | null | undefined} status
 * @param {unknown} [body]
 */
export function isKiteAuthFailure(status, body) {
  if (status === UNAUTHORIZED) return true;
  return status === FORBIDDEN && !isPermissionError(body);
}

/** Whether a reply body carries the KITE_LOGIN_ENDED code. */
export const isKiteLoginEndedReply = (/** @type {unknown} */ body) =>
  typeof body === 'object' && body !== null && 'code' in body && body.code === KITE_LOGIN_ENDED;
