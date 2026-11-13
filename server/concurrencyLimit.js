/** A per-key counter that refuses more than `max` at once. In-memory: it guards this server process only. */
export function createConcurrencyLimit(max) {
  const running = new Map();
  return {
    tryAcquire(key) {
      const count = running.get(key) || 0;
      if (count >= max) return false;
      running.set(key, count + 1);
      return true;
    },
    release(key) {
      const count = running.get(key) || 0;
      if (count <= 1) running.delete(key);
      else running.set(key, count - 1);
    },
    count(key) {
      return running.get(key) || 0;
    },
  };
}
