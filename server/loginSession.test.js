import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import { startLoggedInSession } from './loginSession.js';

let server;
let base;
const store = new session.MemoryStore();

beforeAll(async () => {
  const app = express();
  app.use(session({ store, name: 'sid', secret: 'test-secret', resave: false, saveUninitialized: false }));
  // Stands in for any pre-login visit that gives the browser a session cookie.
  app.get('/visit', (req, res) => {
    req.session.visited = true;
    res.json({ id: req.sessionID });
  });
  app.post('/login', async (req, res) => {
    await startLoggedInSession(req, { userId: 'AB1234' });
    res.json({ id: req.sessionID });
  });
  app.get('/me', (req, res) => res.json({ userId: req.session.kiteSession?.userId ?? null }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterAll(() => server.close());

const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
const storedIds = () => new Promise((resolve) => store.all((_err, sessions) => resolve(Object.keys(sessions))));

describe('startLoggedInSession', () => {
  it('logs in under a new session ID, so a planted pre-login ID never gets the login', async () => {
    const visit = await fetch(`${base}/visit`);
    const plantedCookie = cookieOf(visit);
    const { id: plantedId } = await visit.json();

    const login = await fetch(`${base}/login`, { method: 'POST', headers: { cookie: plantedCookie } });
    const { id: loggedInId } = await login.json();

    expect(loggedInId).not.toBe(plantedId);
    expect(await storedIds()).not.toContain(plantedId);
    expect(await (await fetch(`${base}/me`, { headers: { cookie: plantedCookie } })).json()).toEqual({ userId: null });
    expect(await (await fetch(`${base}/me`, { headers: { cookie: cookieOf(login) } })).json()).toEqual({ userId: 'AB1234' });
  });
});
