/**
 * The key that signs session cookies. The cookie holds only a session ID (the
 * session itself is in Postgres), so a known key doesn't create logins, but it
 * turns any session ID that leaks (a log, a database dump) into a working
 * cookie, admins included. Production must set its own SESSION_SECRET.
 * Local dev falls back to a fixed value so `npm run dev` works with no setup.
 */

export const DEV_SESSION_SECRET = 'insecure-dev-secret';

/** The session secret for this environment, or an error when production has none of its own. */
export function resolveSessionSecret({ secret, isProd }) {
  if (secret && secret !== DEV_SESSION_SECRET) return { value: secret };
  if (isProd) return { error: 'SESSION_SECRET must be set to a private random value in production' };
  return { value: secret || DEV_SESSION_SECRET };
}
