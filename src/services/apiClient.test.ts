import { describe, it, expect } from 'vitest';
import { isLoginEnded, responseErrorMessage } from './apiClient';

describe('isLoginEnded', () => {
  it('logs out on 401 and on a 403 for an expired login', () => {
    expect(isLoginEnded(401, null)).toBe(true);
    expect(isLoginEnded(403, { error_type: 'TokenException' })).toBe(true);
    expect(isLoginEnded(403, { status: 'error', message: 'Admin access required' })).toBe(true);
  });

  it('does not log out when Kite refuses a call this app is not allowed', () => {
    expect(isLoginEnded(403, { status: 'error', message: 'Insufficient permission for that call.', error_type: 'PermissionException' })).toBe(false);
  });

  it('ignores other statuses', () => {
    expect(isLoginEnded(500, null)).toBe(false);
    expect(isLoginEnded(200, null)).toBe(false);
  });
});

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
