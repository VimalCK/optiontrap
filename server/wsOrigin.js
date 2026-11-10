/**
 * Which pages may open the live-price WebSocket (`/ws` in server/index.js). A browser sends the
 * session cookie with a WebSocket from any site that SameSite allows, so the upgrade also checks
 * the page's Origin: only the app's own pages may connect (no cross-site WebSocket hijacking).
 * The Origin's host must match the host the request was sent to: the Host header, or
 * X-Forwarded-Host behind a proxy. In dev, Vite's `/ws` proxy keeps the browser's Host header.
 * A request without an Origin isn't from a browser page, so the cookie check alone decides it.
 */

/** The host (name and port) of an Origin header, or null when it isn't a valid http(s) origin. */
function originHost(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : null;
  } catch {
    return null;
  }
}

/** Whether an upgrade request's Origin is the app's own site. Never throws. */
export function isSameSiteWsOrigin(headers) {
  const { origin } = headers;
  if (origin === undefined) return true;
  const host = originHost(origin);
  if (!host) return false;
  const requestHosts = [headers.host, headers['x-forwarded-host']].filter(Boolean).map((value) => String(value).toLowerCase());
  return requestHosts.includes(host.toLowerCase());
}
