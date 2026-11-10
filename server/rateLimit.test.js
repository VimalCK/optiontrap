import { describe, it, expect, afterEach } from 'vitest';
import { clientIp, createRateLimiter } from './rateLimit.js';

const request = (headers = {}, remoteAddress = '203.0.113.9') => ({ headers, socket: { remoteAddress } });

const fakeResponse = () => ({
  statusCode: 200,
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json() { return this; },
});

/** Send each request through the limiter; the status codes it answered with (200 = passed on). */
const statuses = (limiter, requests) => requests.map((req) => {
  const res = fakeResponse();
  limiter(req, res, () => {});
  return res.statusCode;
});

let limiter;
afterEach(() => limiter?.close());

describe('createRateLimiter', () => {
  it('limits a client that sends a different X-Forwarded-For on every request', () => {
    limiter = createRateLimiter({ max: 2 });
    const spoofed = [1, 2, 3].map((i) => request({ 'x-forwarded-for': `10.0.0.${i}` }));
    expect(statuses(limiter, spoofed)).toEqual([200, 200, 429]);
  });

  it('counts each Cloudflare client IP separately', () => {
    limiter = createRateLimiter({ max: 1 });
    const viaCloudflare = (ip) => request({ 'cf-connecting-ip': ip }, '172.64.0.1');
    expect(statuses(limiter, [viaCloudflare('198.51.100.1'), viaCloudflare('198.51.100.2'), viaCloudflare('198.51.100.1')]))
      .toEqual([200, 200, 429]);
  });
});

describe('clientIp', () => {
  it("is Cloudflare's client IP when present, else the socket address, never X-Forwarded-For", () => {
    expect(clientIp(request({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIp(request({ 'x-forwarded-for': '10.0.0.1' }))).toBe('203.0.113.9');
  });
});
