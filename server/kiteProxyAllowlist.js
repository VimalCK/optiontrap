/**
 * The Kite calls the browser may make through the /api proxy (server/index.js).
 * The proxy adds the user's own Kite login, and Kite's API can also place, change
 * and cancel real orders, so only the read-only calls the app uses get through.
 * OptionTrap never places real orders; this makes the server enforce it.
 * When the app needs another Kite call, add it here (src/services/kiteApi.ts and
 * src/pages/Profile.tsx make the current ones).
 */

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

/**
 * Middleware in front of the Kite proxy: refuses any other call with 404 (not 403,
 * which the browser's apiClient reads as an ended Kite login).
 */
export function allowOnlyKnownKiteCalls(req, res, next) {
  if (isAllowedKiteRequest(req.method, req.path)) return next();
  res.status(404).json({ status: 'error', message: 'Not available through OptionTrap' });
}
