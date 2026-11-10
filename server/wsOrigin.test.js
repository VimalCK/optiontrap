import { describe, it, expect } from 'vitest';
import { isSameSiteWsOrigin } from './wsOrigin.js';

describe('isSameSiteWsOrigin', () => {
  it("accepts the app's own page, by Host or by a proxy's X-Forwarded-Host", () => {
    expect(isSameSiteWsOrigin({ origin: 'https://optiontrap.com', host: 'optiontrap.com' })).toBe(true);
    expect(isSameSiteWsOrigin({ origin: 'http://localhost:3000', host: 'localhost:3000' })).toBe(true);
    expect(isSameSiteWsOrigin({ origin: 'https://optiontrap.com', host: 'internal:8080', 'x-forwarded-host': 'optiontrap.com' })).toBe(true);
  });

  it("refuses another site's page, including a look-alike host or another port", () => {
    expect(isSameSiteWsOrigin({ origin: 'https://evil.example', host: 'optiontrap.com' })).toBe(false);
    expect(isSameSiteWsOrigin({ origin: 'https://optiontrap.com.evil.example', host: 'optiontrap.com' })).toBe(false);
    expect(isSameSiteWsOrigin({ origin: 'http://localhost:4000', host: 'localhost:3000' })).toBe(false);
  });

  it('refuses a malformed or opaque Origin without throwing', () => {
    expect(isSameSiteWsOrigin({ origin: 'null', host: 'optiontrap.com' })).toBe(false);
    expect(isSameSiteWsOrigin({ origin: '%%%', host: 'optiontrap.com' })).toBe(false);
    expect(isSameSiteWsOrigin({ origin: 'file:///x', host: 'optiontrap.com' })).toBe(false);
  });

  it('leaves a request without an Origin (not a browser page) to the cookie check', () => {
    expect(isSameSiteWsOrigin({ host: 'optiontrap.com' })).toBe(true);
  });
});
