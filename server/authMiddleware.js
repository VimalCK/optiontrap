import { getUserSubscription, isUserAdmin } from './db.js';
import { SUBSCRIPTION_REQUIRED, checkSubscriptionAccess, inactiveSubscription } from './subscriptionAccess.js';
import { withFailureMessage } from './asyncRoutes.js';
import { AccessDenial } from '../shared/appEnums.js';
import { sendError } from './replies.js';

export const accessDeps = { getUserSubscription, isUserAdmin };

export async function getSubscriptionSummary(userId) {
  return (await getUserSubscription(userId)) || inactiveSubscription;
}

export async function getSafeSession(kiteSession) {
  if (!kiteSession) return null;

  const { accessToken, apiKey, ...safe } = kiteSession;
  // Read live from the DB, so sessions created before the admin flag existed still reflect it.
  safe.isAdmin = await isUserAdmin(kiteSession.userId);
  safe.subscription = await getSubscriptionSummary(kiteSession.userId);

  return safe;
}

export const requireAuth = (req, res, next) => {
  if (!req.session?.kiteSession?.apiKey) {
    return sendError(res, 401, 'Not authenticated');
  }
  next();
};

export const requireAdmin = withFailureMessage('Failed to verify admin access', async function requireAdmin(req, res, next) {
  const userId = req.session?.kiteSession?.userId;
  if (!userId) return sendError(res, 401, 'Not authenticated');
  // Checked live against the DB, not the session's flag, so a role change applies without a new login.
  if (!(await isUserAdmin(userId))) return sendError(res, 403, 'Admin access required');
  next();
});

export const requireSubscription = withFailureMessage('Failed to verify subscription', async function requireSubscription(req, res, next) {
  const access = await checkSubscriptionAccess(req.session?.kiteSession?.userId, accessDeps);
  if (access.allowed) {
    req.subscription = access.subscription;
    return next();
  }
  if (access.reason === AccessDenial.Unauthenticated) return sendError(res, 401, 'Not authenticated');
  sendError(res, 402, 'An active subscription is required', { code: SUBSCRIPTION_REQUIRED, data: access.subscription });
});

/** A logged-in user with a subscription (admins pass without one): every app feature. */
export const subscriber = [requireAuth, requireSubscription];

/** A logged-in admin: shared data and the admin screens. */
export const admin = [requireAuth, requireAdmin];
