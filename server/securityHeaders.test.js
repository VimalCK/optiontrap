import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { contentSecurityPolicy, securityHeaders } from './securityHeaders.js';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.get('/page', (_req, res) => res.send('<!doctype html>'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterAll(() => server.close());

describe('securityHeaders', () => {
  it('stops framing, sniffing and outside scripts', async () => {
    const { headers } = await fetch(`${base}/page`);
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    const csp = headers.get('content-security-policy');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("object-src 'none'");
  });

  it('sends HSTS only for HTTPS requests', async () => {
    expect((await fetch(`${base}/page`)).headers.get('strict-transport-security')).toBeNull();
    const behindProxy = await fetch(`${base}/page`, { headers: { 'x-forwarded-proto': 'https' } });
    expect(behindProxy.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });
});

describe('contentSecurityPolicy', () => {
  it('joins each directive with its sources', () => {
    expect(contentSecurityPolicy({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] }))
      .toBe("default-src 'self'; img-src 'self' data:");
  });
});
