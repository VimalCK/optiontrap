/**
 * Kite answers 403 for two different things: an expired or revoked login
 * (TokenException) and a call this Kite app isn't allowed to make
 * (PermissionException, e.g. quotes without market-data access). Only the
 * first ends the user's Kite login.
 */
import zlib from 'node:zlib';

/** Whether a Kite 403 error body means the login itself is no longer valid. */
export function isKiteLoginError(body) {
  return body?.error_type !== 'PermissionException';
}

/**
 * The parsed JSON body of a Kite response stream, decompressed as its
 * content-encoding says; null if it can't be read. Listens alongside the
 * proxy's own piping, so the browser still gets the response unchanged.
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
