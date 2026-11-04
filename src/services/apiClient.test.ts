import { describe, it, expect } from 'vitest';
import { isLoginEnded } from './apiClient';

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
