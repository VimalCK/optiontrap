/**
 * Generic in-memory TTL cache utilities.
 *
 * Use `cached(fn, ttlMs, keyFn?)` to wrap any async function so its result is
 * memoised for `ttlMs`. Choose the TTL per scenario at the call site:
 *
 *   const getPlans   = cached(getActiveSubscriptionPlans, 30 * 60_000);   // 30 min
 *   const getConfig  = cached(loadConfig,                  5 * 60_000);   // 5 min
 *   const getQuote   = cached(fetchQuote, 2_000, (symbol) => symbol);     // 2s, per-symbol
 *
 * Features:
 *  - Per-key TTL expiry (lazy — evaluated on read).
 *  - Single-flight: concurrent misses for the same key share ONE underlying
 *    call, preventing a cache stampede from flooding the source (DB/API).
 *  - Errors are never cached and propagate to all awaiting callers.
 *  - Manual busting via `.invalidate(...args)` and `.clear()`.
 */

/**
 * Wrap an async function with a TTL cache.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn                      The async function to memoise.
 * @param {number} ttlMs              Time-to-live for cached results, in ms.
 * @param {(...args: Parameters<F>) => string} [keyFn]
 *        Derives a cache key from the arguments. Defaults to a single shared
 *        key (suitable for zero-argument loaders).
 * @returns {F & { invalidate: (...args: Parameters<F>) => void, clear: () => void }}
 */
export function cached(fn, ttlMs, keyFn = () => '__default__') {
  /** @type {Map<string, { value: any, expires: number }>} */
  const store = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  const wrapped = (...args) => {
    const key = keyFn(...args);
    const now = Date.now();

    const hit = store.get(key);
    if (hit && hit.expires > now) {
      return Promise.resolve(hit.value);
    }

    // A refresh is already running for this key — share it (single-flight).
    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = Promise.resolve()
      .then(() => fn(...args))
      .then((value) => {
        store.set(key, { value, expires: Date.now() + ttlMs });
        inflight.delete(key);
        return value;
      })
      .catch((err) => {
        inflight.delete(key); // never cache failures
        throw err;
      });

    inflight.set(key, promise);
    return promise;
  };

  wrapped.invalidate = (...args) => { store.delete(keyFn(...args)); };
  wrapped.clear = () => { store.clear(); };

  return wrapped;
}
