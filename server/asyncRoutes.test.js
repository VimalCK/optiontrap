import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { asyncRouter, catchAsyncErrors, sendFailure, sendServerError, withFailureMessage } from './asyncRoutes.js';

let server;
let base;

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  catchAsyncErrors(app);
  app.set('trust proxy', 1);
  app.use(express.json());
  const slowCheck = async (_req, _res, next) => next();
  app.post('/watchlists', slowCheck, async (req, res) => {
    if (!req.body.name.trim()) return res.status(400).end();
    res.status(201).json({ status: 'ok' });
  });
  app.get('/sync-throw', () => { throw new Error('boom'); });
  app.get('/db-failure', (_req, res) => {
    sendFailure(res, new Error('relation "watchlists" does not exist'), { log: '[Test] load', message: 'Failed to load watchlists' });
  });
  app.get('/kite-failure', (_req, res) => {
    sendFailure(res, new Error('Kite: Incorrect `api_key` or `access_token`'), { log: '[Test] Kite', message: 'Failed to load instruments', status: 502 });
  });
  app.get('/ok', (_req, res) => res.json({ status: 'ok', data: app.get('trust proxy') }));

  const router = asyncRouter();
  const failingGuard = async () => { throw new Error('guard down'); };
  router.get('/routed/guarded', [async (_req, _res, next) => next(), failingGuard], (_req, res) => res.json({ status: 'ok' }));
  router.get('/routed/own-message', withFailureMessage('Failed to load OI history', async () => {
    throw new Error('relation "oi_history" does not exist');
  }));
  router.get('/routed/kite-down', withFailureMessage('Failed to load instruments from Kite', async () => {
    throw new Error('Kite timeout');
  }, { status: 502 }));
  router.get('/routed/guard-message', withFailureMessage('Failed to verify admin access', async (_req, _res, next) => next()), (_req, res) => res.json({ status: 'ok' }));
  app.use(router);

  app.use(sendServerError);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterAll(() => {
  server.close();
  vi.restoreAllMocks();
});

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('catchAsyncErrors', () => {
  it('answers 500 when an async route throws, and the server keeps serving', async () => {
    const res = await post('/watchlists', JSON.stringify({ name: 123 }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: 'error', message: 'Something went wrong on the server' });
    expect((await post('/watchlists', JSON.stringify({ name: 'Mine' }))).status).toBe(201);
  });

  it('answers 500 when a plain route throws', async () => {
    expect((await fetch(`${base}/sync-throw`)).status).toBe(500);
  });

  it('keeps a body-parser 400 for malformed JSON, as JSON', async () => {
    const res = await post('/watchlists', '{"name":');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: 'error', message: 'Invalid request' });
  });

  it('still lets app.get read a setting', async () => {
    expect(await (await fetch(`${base}/ok`)).json()).toEqual({ status: 'ok', data: 1 });
  });
});

describe('sendFailure', () => {
  it("replies with the route's message, not the database error's text", async () => {
    const res = await fetch(`${base}/db-failure`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: 'error', message: 'Failed to load watchlists' });
  });

  it('keeps the given status and hides Kite error text', async () => {
    const res = await fetch(`${base}/kite-failure`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: 'error', message: 'Failed to load instruments' });
  });
});

describe('asyncRouter', () => {
  it('passes a rejected guard given in an array to the error handler', async () => {
    const res = await fetch(`${base}/routed/guarded`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: 'error', message: 'Something went wrong on the server' });
  });

  it('keeps each handler name, so a route can be checked for its guards', () => {
    const named = asyncRouter();
    async function requireAuth(_req, _res, next) { next(); }
    named.get('/x', [requireAuth], function handler() {});
    expect(named.stack[0].route.stack.map((layer) => layer.handle.name)).toEqual(['requireAuth', 'handler']);
  });
});

describe('withFailureMessage', () => {
  it("answers a thrown error with the route's message, not the error's text", async () => {
    const res = await fetch(`${base}/routed/own-message`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: 'error', message: 'Failed to load OI history' });
  });

  it('uses the given status', async () => {
    const res = await fetch(`${base}/routed/kite-down`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: 'error', message: 'Failed to load instruments from Kite' });
  });

  it('lets a wrapped guard hand on to the next handler', async () => {
    expect(await (await fetch(`${base}/routed/guard-message`)).json()).toEqual({ status: 'ok' });
  });
});
