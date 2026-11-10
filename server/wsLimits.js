/**
 * Limits for the browser → Kite WebSocket proxy (`/ws` in server/index.js), so one
 * user can't use up the server's memory or sockets. Both come from Kite's own
 * ticker limits: anything beyond them Kite would refuse anyway. The per-user
 * count itself is server/concurrencyLimit.js.
 */

/** Kite allows 3 ticker connections per API key, and each proxy connection opens one. */
export const MAX_CONNECTIONS_PER_USER = 3;

/**
 * The largest message a browser may send. Its biggest real message is a subscribe or
 * mode for Kite's 3000-instrument maximum, about 33 KB of JSON (3000 tokens of up to
 * 10 digits plus commas); twice that leaves room without allowing ws's 100 MB default.
 */
export const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
