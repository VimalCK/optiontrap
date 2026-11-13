/**
 * Single-flight: concurrent misses for one key share one underlying call, so a stampede can't flood the DB or API.
 * Errors are never cached.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn
 * @param {number} ttlMs
 * @param {(...args: Parameters<F>) => string} [keyFn]
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
        inflight.delete(key);
        throw err;
      });

    inflight.set(key, promise);
    return promise;
  };

  wrapped.invalidate = (...args) => { store.delete(keyFn(...args)); };
  wrapped.clear = () => { store.clear(); };

  return wrapped;
}
