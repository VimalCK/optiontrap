import { describe, it, expect } from 'vitest';
import { MAX_CLIENT_MESSAGE_BYTES } from './wsLimits.js';

describe('MAX_CLIENT_MESSAGE_BYTES', () => {
  it('fits a subscribe for Kite\'s 3000-instrument maximum', () => {
    const tokens = Array.from({ length: 3000 }, (_, i) => 4294967295 - i);
    const message = JSON.stringify({ a: 'subscribe', v: tokens });
    expect(Buffer.byteLength(message)).toBeLessThan(MAX_CLIENT_MESSAGE_BYTES);
  });
});
