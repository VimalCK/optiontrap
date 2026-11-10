/**
 * Counts how many of something each user has running (WebSocket connections,
 * OI history fetches) and refuses one more than the maximum, so a single user
 * can't tie up the server's sockets, memory or Kite calls. In-memory: it guards
 * this server process, which is the one doing the work.
 */

/** A per-key counter that refuses more than `max` at once. */
export function createConcurrencyLimit(max) {
  const running = new Map();
  return {
    /** Reserve a slot for `key`; false when it already has `max` running. */
    tryAcquire(key) {
      const count = running.get(key) || 0;
      if (count >= max) return false;
      running.set(key, count + 1);
      return true;
    },
    /** Free a slot reserved by `tryAcquire`. */
    release(key) {
      const count = running.get(key) || 0;
      if (count <= 1) running.delete(key);
      else running.set(key, count - 1);
    },
    /** How many `key` has running. */
    count(key) {
      return running.get(key) || 0;
    },
  };
}
