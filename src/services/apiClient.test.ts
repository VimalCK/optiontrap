import { describe, it, expect } from 'vitest';
import { responseErrorMessage } from './apiClient';

describe('responseErrorMessage', () => {
  it('reads the message from a JSON error reply', async () => {
    const response = new Response(JSON.stringify({ status: 'error', message: 'An OI history fetch is already running' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await responseErrorMessage(response)).toBe('An OI history fetch is already running');
  });

  it('falls back to the status when the reply has no message', async () => {
    expect(await responseErrorMessage(new Response('Bad Gateway', { status: 502 }))).toBe('Request failed (502)');
  });
});
