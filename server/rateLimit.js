/**
 * In-memory sliding-window rate limiter.
 *
 * Each limiter tracks request counts per key (IP or user) within a
 * configurable time window. When a key exceeds its budget, subsequent
 * requests receive 429 Too Many Requests until the window slides forward.
 *
 * Cleanup runs every 5 minutes to evict expired entries so memory stays
 * bounded even under sustained traffic.
 */

/**
 * Create a rate-limiting middleware.
 *
 * @param {object}   opts
 * @param {number}   opts.windowMs   - Time window in milliseconds (default 60 000)
 * @param {number}   opts.max        - Max requests per key per window (default 60)
 * @param {Function} [opts.keyFn]    - Extract key from req (default: IP address)
 * @param {string}   [opts.message]  - Response message on limit hit
 */
export function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  keyFn,
  message = 'Too many requests, please try again later',
} = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  // Periodic cleanup — evict expired entries every 5 minutes
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, 5 * 60_000);

  if (cleanup.unref) cleanup.unref();

  const defaultKeyFn = (req) => {
    // Trust X-Forwarded-For when behind a reverse proxy (nginx, Cloudflare)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || 'unknown';
  };

  const getKey = keyFn || defaultKeyFn;

  const middleware = (req, res, next) => {
    const key = getKey(req);
    const now = Date.now();

    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    // Standard rate-limit headers
    const remaining = Math.max(0, max - entry.count);
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ status: 'error', message });
    }

    next();
  };

  // Expose cleanup for graceful shutdown
  middleware.close = () => clearInterval(cleanup);

  return middleware;
}
