import { describe, it, expect } from 'vitest';
import { KITE_LOGIN_ENDED, isKiteAuthFailure, isKiteLoginEndedReply } from './kiteAuth.js';
import { KiteErrorType } from './tradeEnums.js';

const TOKEN = { status: 'error', message: 'Incorrect `api_key` or `access_token`.', error_type: KiteErrorType.TokenException };
const PERMISSION = { status: 'error', message: 'Insufficient permission for that call.', error_type: KiteErrorType.PermissionException };

describe('isKiteAuthFailure', () => {
  it('ends the login on a 401, and on a 403 for an expired login', () => {
    expect(isKiteAuthFailure(401, null)).toBe(true);
    expect(isKiteAuthFailure(403, TOKEN)).toBe(true);
    expect(isKiteAuthFailure(403, { status: 'error', message: 'Admin access required' })).toBe(true);
  });

  it('leaves the login alone when Kite refuses a call this app is not allowed', () => {
    expect(isKiteAuthFailure(403, PERMISSION)).toBe(false);
  });

  it('counts every 401/403 when the body is unknown (a WebSocket handshake, a status-only error)', () => {
    expect(isKiteAuthFailure(403)).toBe(true);
    expect(isKiteAuthFailure(401)).toBe(true);
    expect(isKiteAuthFailure(403, null)).toBe(true);
  });

  it('ignores every other status', () => {
    expect(isKiteAuthFailure(200, null)).toBe(false);
    expect(isKiteAuthFailure(409, { code: 'MARKET_CLOSED' })).toBe(false);
    expect(isKiteAuthFailure(429)).toBe(false);
    expect(isKiteAuthFailure(500, null)).toBe(false);
    expect(isKiteAuthFailure(undefined)).toBe(false);
    expect(isKiteAuthFailure(null)).toBe(false);
  });
});

describe('isKiteLoginEndedReply', () => {
  it('is true only for a reply carrying the KITE_LOGIN_ENDED code', () => {
    expect(isKiteLoginEndedReply({ message: 'Your Kite login has ended · log in again', code: KITE_LOGIN_ENDED })).toBe(true);
    // The old regex check never matched this server message, so an ended login showed as a fetch error.
    expect(isKiteLoginEndedReply({ message: 'Failed to fetch NIFTY spot candles (Kite answered 403)' })).toBe(false);
    expect(isKiteLoginEndedReply({ code: 'SUBSCRIPTION_REQUIRED' })).toBe(false);
    expect(isKiteLoginEndedReply(null)).toBe(false);
  });
});
