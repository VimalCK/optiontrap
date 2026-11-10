/**
 * Limits for the browser → Kite WebSocket proxy (`/ws` in server/index.js), so one
 * user can't use up the server's memory or sockets. Both come from Kite's own
 * ticker limits: anything beyond them Kite would refuse anyway.
 */

/** Kite allows 3 ticker connections per API key, and each proxy connection opens one. */
export const MAX_CONNECTIONS_PER_USER = 3;

/**
 * The largest message a browser may send. Its biggest real message is a subscribe or
 * mode for Kite's 3000-instrument maximum, about 33 KB of JSON (3000 tokens of up to
 * 10 digits plus commas); twice that leaves room without allowing ws's 100 MB default.
 */
export const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;

/** Counts open connections per user, refusing one more than `max`. */
export function createConnectionCounter(max) {
  const open = new Map();
  return {
    /** Reserve a connection for `userId`; false when they already have `max` open. */
    tryAcquire(userId) {
      const count = open.get(userId) || 0;
      if (count >= max) return false;
      open.set(userId, count + 1);
      return true;
    },
    /** Free a connection reserved by `tryAcquire`. */
    release(userId) {
      const count = open.get(userId) || 0;
      if (count <= 1) open.delete(userId);
      else open.set(userId, count - 1);
    },
    /** Open connections for `userId`. */
    count(userId) {
      return open.get(userId) || 0;
    },
  };
}
