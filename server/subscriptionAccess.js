// Shared access rule for paid features, used by both the HTTP
// requireSubscription middleware and the /ws live-tick upgrade handler so the
// two gates cannot drift apart. DB lookups are injected to keep this testable.
import { AccessDenial, SubscriptionState } from '../shared/appEnums.js';

export const inactiveSubscription = {
  status: SubscriptionState.Inactive,
  active: false,
  planId: null,
  plan: null,
  startsAt: null,
  expiresAt: null,
};

export const adminSubscription = {
  status: SubscriptionState.Admin, active: true, planId: null, plan: null, startsAt: null, expiresAt: null,
};

/**
 * Decide whether a user may use subscription-gated features.
 * Active subscribers pass; admins pass without a subscription.
 *
 * @returns {Promise<{ allowed: true, subscription: object }
 *   | { allowed: false, reason: import('../shared/appEnums.js').AccessDenialId, subscription?: object }>}
 */
export async function checkSubscriptionAccess(userId, { getUserSubscription, isUserAdmin }) {
  if (!userId) return { allowed: false, reason: AccessDenial.Unauthenticated };

  const subscription = (await getUserSubscription(userId)) || inactiveSubscription;

  // Fast path: active subscribers pass with a single query.
  if (subscription.active) return { allowed: true, subscription };

  // No active subscription — admins are the ultimate role and pass anyway.
  if (await isUserAdmin(userId)) return { allowed: true, subscription: adminSubscription };

  return { allowed: false, reason: AccessDenial.SubscriptionRequired, subscription };
}
