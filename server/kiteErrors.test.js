import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';
import { isKiteLoginError, readKiteBody } from './kiteErrors.js';

const PERMISSION = { status: 'error', message: 'Insufficient permission for that call.', error_type: 'PermissionException' };
const TOKEN = { status: 'error', message: 'Incorrect `api_key` or `access_token`.', error_type: 'TokenException' };

/** A proxied Kite response stream carrying `body`, compressed as `encoding` says. */
function kiteResponse(body, encoding) {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const stream = new PassThrough();
  stream.headers = encoding ? { 'content-encoding': encoding } : {};
  stream.end(encoding === 'gzip' ? zlib.gzipSync(raw) : encoding === 'br' ? zlib.brotliCompressSync(raw) : raw);
  return stream;
}

describe('a Kite 403', () => {
  it('ends the login for a TokenException, not for a PermissionException', () => {
    expect(isKiteLoginError(TOKEN)).toBe(true);
    expect(isKiteLoginError(PERMISSION)).toBe(false);
  });

  it('ends the login when the body cannot be read, as before', () => {
    expect(isKiteLoginError(null)).toBe(true);
  });

  it('reads the error body, plain or compressed', async () => {
    expect(await readKiteBody(kiteResponse(PERMISSION))).toEqual(PERMISSION);
    expect(await readKiteBody(kiteResponse(PERMISSION, 'gzip'))).toEqual(PERMISSION);
    expect(await readKiteBody(kiteResponse(TOKEN, 'br'))).toEqual(TOKEN);
    expect(await readKiteBody(kiteResponse('<html>Forbidden</html>'))).toBeNull();
  });
});
