import { describe, it, expect, vi } from 'vitest';
import { checkSubscriptionAccess, adminSubscription, inactiveSubscription } from './subscriptionAccess.js';

const activeSubscription = { status: 'active', active: true, planId: 'monthly' };
const expiredSubscription = { status: 'expired', active: false, planId: 'monthly' };

const deps = ({ subscription = null, admin = false } = {}) => ({
  getUserSubscription: vi.fn(async () => subscription),
  isUserAdmin: vi.fn(async () => admin),
});

describe('checkSubscriptionAccess', () => {
  it('lets an active subscriber in without an admin lookup', async () => {
    const d = deps({ subscription: activeSubscription });
    await expect(checkSubscriptionAccess('AB1234', d)).resolves.toEqual({ allowed: true, subscription: activeSubscription });
    expect(d.isUserAdmin).not.toHaveBeenCalled();
  });

  it('lets an admin in without a subscription', async () => {
    // Regression: the /ws gate rejected admins with 402, so they got no live ticks.
    await expect(checkSubscriptionAccess('AB1234', deps({ admin: true })))
      .resolves.toEqual({ allowed: true, subscription: adminSubscription });
  });

  it('lets an admin in when their subscription has expired', async () => {
    await expect(checkSubscriptionAccess('AB1234', deps({ subscription: expiredSubscription, admin: true })))
      .resolves.toMatchObject({ allowed: true });
  });

  it('rejects a non-admin with no subscription', async () => {
    await expect(checkSubscriptionAccess('AB1234', deps()))
      .resolves.toEqual({ allowed: false, reason: 'subscription_required', subscription: inactiveSubscription });
  });

  it('rejects a non-admin with an expired subscription', async () => {
    await expect(checkSubscriptionAccess('AB1234', deps({ subscription: expiredSubscription })))
      .resolves.toEqual({ allowed: false, reason: 'subscription_required', subscription: expiredSubscription });
  });

  it('rejects a missing user without touching the DB', async () => {
    const d = deps({ admin: true });
    await expect(checkSubscriptionAccess(undefined, d)).resolves.toEqual({ allowed: false, reason: 'unauthenticated' });
    expect(d.getUserSubscription).not.toHaveBeenCalled();
    expect(d.isUserAdmin).not.toHaveBeenCalled();
  });

  it('propagates DB errors so callers can answer 500', async () => {
    const d = deps();
    d.getUserSubscription.mockRejectedValue(new Error('db down'));
    await expect(checkSubscriptionAccess('AB1234', d)).rejects.toThrow('db down');
  });
});
