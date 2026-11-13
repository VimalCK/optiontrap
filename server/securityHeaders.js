/**
 * In dev, Vite serves the page, so these headers only reach API replies there. Images over HTTPS, since the Kite
 * avatar's host isn't fixed.
 */

/** The page's allowed sources, one entry per directive. Add a source here when the app starts loading one. */
const CONTENT_SECURITY_POLICY = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'https:'],
  'connect-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

/** One year: browsers keep using HTTPS for the site this long after a visit. */
const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The Content-Security-Policy header value built from a directive map. */
export function contentSecurityPolicy(policy = CONTENT_SECURITY_POLICY) {
  return Object.entries(policy).map(([directive, sources]) => `${directive} ${sources.join(' ')}`).join('; ');
}

const STATIC_HEADERS = {
  'Content-Security-Policy': contentSecurityPolicy(),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** Express middleware setting the security headers; HSTS only on HTTPS requests. */
export function securityHeaders(req, res, next) {
  res.set(STATIC_HEADERS);
  if (req.secure) res.set('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_SECONDS}`);
  next();
}
