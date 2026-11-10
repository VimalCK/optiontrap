import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { catchAsyncErrors, sendServerError } from './asyncRoutes.js';

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
  app.get('/ok', (_req, res) => res.json({ status: 'ok', data: app.get('trust proxy') }));
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
