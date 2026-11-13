/** A 403 TokenException ends the login (shared/kiteAuth.js); a 403 PermissionException doesn't. */
import zlib from 'node:zlib';

/**
 * Listens alongside the proxy's own piping, so the browser still gets the response unchanged.
 * @param {import('node:http').IncomingMessage} res
 */
export function readKiteBody(res) {
  return new Promise((resolve) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('error', () => resolve(null));
    res.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        const text = encoding === 'gzip' ? zlib.gunzipSync(raw)
          : encoding === 'deflate' ? zlib.inflateSync(raw)
            : encoding === 'br' ? zlib.brotliDecompressSync(raw)
              : raw;
        resolve(JSON.parse(text.toString('utf8')));
      } catch {
        resolve(null);
      }
    });
  });
}
