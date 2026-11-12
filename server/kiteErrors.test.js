import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';
import { readKiteBody } from './kiteErrors.js';

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

describe('a Kite error reply', () => {
  it('reads the error body, plain or compressed', async () => {
    expect(await readKiteBody(kiteResponse(PERMISSION))).toEqual(PERMISSION);
    expect(await readKiteBody(kiteResponse(PERMISSION, 'gzip'))).toEqual(PERMISSION);
    expect(await readKiteBody(kiteResponse(TOKEN, 'br'))).toEqual(TOKEN);
    expect(await readKiteBody(kiteResponse('<html>Forbidden</html>'))).toBeNull();
  });
});
