/**
 * Reads the signed session ID from a WebSocket upgrade request's Cookie header. Express middleware
 * doesn't run on upgrades, so `/ws` in server/index.js checks the cookie itself. Nothing here may
 * throw: an error in the upgrade handler isn't caught and stops the whole server, so a malformed
 * cookie (e.g. a bad `%` escape) is treated like a missing one.
 */
import cookieParser from 'cookie-parser';

function readCookie(cookieHeader, name) {
  for (const part of (cookieHeader || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function decodeCookieValue(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** The session ID from the named signed cookie, or null when it is missing, malformed, unsigned or wrongly signed. */
export function signedSessionId(cookieHeader, cookieName, secret) {
  const raw = readCookie(cookieHeader, cookieName);
  if (!raw) return null;
  const value = decodeCookieValue(raw);
  if (!value) return null;
  const sid = cookieParser.signedCookie(value, secret);
  return sid && sid !== value ? sid : null;
}
