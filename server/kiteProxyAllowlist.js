/**
 * Kite's API can place, change and cancel real orders, and OptionTrap never does: only the read-only calls the app
 * uses get through. When the app needs another Kite call, add it here.
 */

import { sendError } from './replies.js';

/** Allowed calls: GET only, matched against the whole path after /api. */
const ALLOWED_KITE_PATHS = [
  /^\/quote$/,
  /^\/portfolio\/holdings$/,
  /^\/portfolio\/positions$/,
  /^\/user\/margins$/,
  /^\/user\/profile$/,
  /^\/instruments\/historical\/\d+\/day$/,
];

/** Whether the proxy may pass this request on to Kite. */
export function isAllowedKiteRequest(method, path) {
  return method === 'GET' && ALLOWED_KITE_PATHS.some((pattern) => pattern.test(path));
}

/** Refuses other calls with 404, not 403: the browser's apiClient reads 403 as an ended Kite login. */
export function allowOnlyKnownKiteCalls(req, res, next) {
  if (isAllowedKiteRequest(req.method, req.path)) return next();
  sendError(res, 404, 'Not available through OptionTrap');
}
