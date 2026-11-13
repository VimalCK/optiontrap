import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { getSubscriptionSummary, requireAuth } from '../authMiddleware.js';
import { cached } from '../cache.js';
import { SubscriptionPlanNotFoundError, activateSubscription, getActiveSubscriptionPlans } from '../db.js';
import { SubscriptionProvider } from '../../shared/appEnums.js';
import { sendOk } from '../replies.js';
import { PLAN_NOT_FOUND, sendResult } from './sendResult.js';

export const SUBSCRIPTION_UPDATE_FAILED = 'Failed to update the subscription';

/** A subscription change as a result: an unknown plan is refused (PLAN_NOT_FOUND), any other error is thrown. */
export async function subscriptionChange(change) {
  try {
    return { ok: true, subscription: await change() };
  } catch (err) {
    if (err instanceof SubscriptionPlanNotFoundError) return { ok: false, code: PLAN_NOT_FOUND, message: err.message };
    throw err;
  }
}

// Plans change rarely, and the cache shields the DB from unauthenticated traffic.
const getCachedPlans = cached(getActiveSubscriptionPlans, 30 * 60_000);

export const subscriptionRoutes = asyncRouter();

subscriptionRoutes.get('/api/public/plans', withFailureMessage('Failed to load plans', async (_req, res) => {
  sendOk(res, await getCachedPlans());
}));

subscriptionRoutes.get('/api/subscription/plans', requireAuth, async (_req, res) => {
  sendOk(res, await getActiveSubscriptionPlans());
});

subscriptionRoutes.get('/api/subscription/status', requireAuth, async (req, res) => {
  sendOk(res, await getSubscriptionSummary(req.session.kiteSession.userId));
});

subscriptionRoutes.post('/api/subscriptions', requireAuth, withFailureMessage(SUBSCRIPTION_UPDATE_FAILED, async (req, res) => {
  const { planId } = req.body || {};
  const result = await subscriptionChange(() => activateSubscription(req.session.kiteSession.userId, planId, SubscriptionProvider.Internal));
  sendResult(res, result, { data: result.subscription, created: true });
}));
