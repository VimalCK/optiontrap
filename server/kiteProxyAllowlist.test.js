import { describe, it, expect, vi } from 'vitest';
import { allowOnlyKnownKiteCalls, isAllowedKiteRequest } from './kiteProxyAllowlist.js';

describe('isAllowedKiteRequest', () => {
  it('allows the read-only calls the app makes', () => {
    for (const path of ['/quote', '/portfolio/holdings', '/portfolio/positions', '/user/margins', '/user/profile', '/instruments/historical/341249/day']) {
      expect(isAllowedKiteRequest('GET', path)).toBe(true);
    }
  });

  it('refuses calls that place, change or cancel real orders', () => {
    expect(isAllowedKiteRequest('POST', '/orders/regular')).toBe(false);
    expect(isAllowedKiteRequest('PUT', '/orders/regular/220101000000001')).toBe(false);
    expect(isAllowedKiteRequest('DELETE', '/orders/regular/220101000000001')).toBe(false);
    expect(isAllowedKiteRequest('POST', '/gtt/triggers')).toBe(false);
    expect(isAllowedKiteRequest('PUT', '/portfolio/positions')).toBe(false);
  });

  it('refuses other methods on allowed paths', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(isAllowedKiteRequest(method, '/quote')).toBe(false);
    }
  });

  it('refuses Kite reads the app does not use', () => {
    expect(isAllowedKiteRequest('GET', '/orders')).toBe(false);
    expect(isAllowedKiteRequest('GET', '/instruments/historical/341249/minute')).toBe(false);
  });

  it('refuses paths that only start or end like an allowed one', () => {
    for (const path of ['/quote/../orders/regular', '/quote%2F..%2Forders%2Fregular', '/portfolio/holdings/x', '/x/quote', '/instruments/historical/abc/day', '/user/margins/equity']) {
      expect(isAllowedKiteRequest('GET', path)).toBe(false);
    }
  });
});

describe('allowOnlyKnownKiteCalls', () => {
  const response = () => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    return res;
  };

  it('passes an allowed call on to the proxy', () => {
    const next = vi.fn();
    allowOnlyKnownKiteCalls({ method: 'GET', path: '/quote' }, response(), next);
    expect(next).toHaveBeenCalled();
  });

  it('answers 404, not a logout-triggering 403, for anything else', () => {
    const next = vi.fn();
    const res = response();
    allowOnlyKnownKiteCalls({ method: 'POST', path: '/orders/regular' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'Not available through OptionTrap' });
  });
});
