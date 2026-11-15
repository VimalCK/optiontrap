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

/**
 * Run `fn` on every item, at most `max` at once, starting the next as each one finishes.
 * `fn` handles its own errors: one that throws rejects the whole run while the others carry on.
 * @template T
 * @param {T[]} items
 * @param {number} max
 * @param {(item: T) => Promise<void>} fn
 */
export async function forEachLimited(items, max, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, worker));
}
