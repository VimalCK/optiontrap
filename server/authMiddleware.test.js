import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ getUserSubscription: vi.fn(), isUserAdmin: vi.fn() }));

const db = await import('./db.js');
const { admin, requireAdmin, requireAuth, requireSubscription, subscriber } = await import('./authMiddleware.js');

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const kiteSession = { apiKey: 'k', accessToken: 't', userId: 'U1' };

/** Runs a guard; resolves with the response and whether it handed on to the next handler. */
async function run(guard, session = { kiteSession }) {
  const req = { session, method: 'GET', originalUrl: '/api/x' };
  const res = fakeRes();
  const next = vi.fn();
  await guard(req, res, next);
  return { req, res, passed: next.mock.calls.length === 1 };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requireAuth', () => {
  it('passes a session with a Kite login and refuses one without', async () => {
    expect((await run(requireAuth)).passed).toBe(true);
    const { res, passed } = await run(requireAuth, {});
    expect(passed).toBe(false);
    expect(res).toMatchObject({ statusCode: 401, body: { status: 'error', message: 'Not authenticated' } });
  });
});

describe('requireAdmin', () => {
  it('passes an admin', async () => {
    db.isUserAdmin.mockResolvedValueOnce(true);
    expect((await run(requireAdmin)).passed).toBe(true);
    expect(db.isUserAdmin).toHaveBeenCalledWith('U1');
  });

  it('refuses a user who is not an admin with 403, and no login with 401', async () => {
    db.isUserAdmin.mockResolvedValueOnce(false);
    expect((await run(requireAdmin)).res).toMatchObject({ statusCode: 403, body: { message: 'Admin access required' } });
    expect((await run(requireAdmin, {})).res.statusCode).toBe(401);
  });

  it('answers a failed check with its own message, not the error text', async () => {
    db.isUserAdmin.mockRejectedValueOnce(new Error('connection refused'));
    const { res, passed } = await run(requireAdmin);
    expect(passed).toBe(false);
    expect(res).toMatchObject({ statusCode: 500, body: { status: 'error', message: 'Failed to verify admin access' } });
  });
});

describe('requireSubscription', () => {
  it('passes an active subscriber and keeps the subscription on the request', async () => {
    const subscription = { active: true, planId: 'one_month' };
    db.getUserSubscription.mockResolvedValueOnce(subscription);
    const { req, passed } = await run(requireSubscription);
    expect(passed).toBe(true);
    expect(req.subscription).toBe(subscription);
  });

  it('passes an admin without a subscription', async () => {
    db.getUserSubscription.mockResolvedValueOnce(null);
    db.isUserAdmin.mockResolvedValueOnce(true);
    expect((await run(requireSubscription)).passed).toBe(true);
  });

  it('refuses a user without one with 402 and SUBSCRIPTION_REQUIRED, and no login with 401', async () => {
    db.getUserSubscription.mockResolvedValueOnce(null);
    db.isUserAdmin.mockResolvedValueOnce(false);
    const { res, passed } = await run(requireSubscription);
    expect(passed).toBe(false);
    expect(res).toMatchObject({ statusCode: 402, body: { code: 'SUBSCRIPTION_REQUIRED', message: 'An active subscription is required', data: { active: false } } });
    expect((await run(requireSubscription, {})).res.statusCode).toBe(401);
  });

  it('answers a failed check with its own message', async () => {
    db.getUserSubscription.mockRejectedValueOnce(new Error('timeout'));
    expect((await run(requireSubscription)).res).toMatchObject({ statusCode: 500, body: { message: 'Failed to verify subscription' } });
  });
});

describe('guard lists', () => {
  it('put the login check first', () => {
    expect(subscriber).toEqual([requireAuth, requireSubscription]);
    expect(admin).toEqual([requireAuth, requireAdmin]);
  });
});
