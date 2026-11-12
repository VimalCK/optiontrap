import { SubscriptionPlan, SubscriptionStatus } from './kiteAuth';
import { apiClient } from './apiClient';
import { durationUnitLabel } from '../../shared/appEnums.js';

/**
 * Human-readable duration label from the generic count + unit model.
 * e.g. (1, Month) -> "month", (6, Month) -> "6 months", (7, Day) -> "7 days".
 */
export function formatDuration(count: number, unit: string): string {
  const n = count || 1;
  const label = durationUnitLabel(unit);
  return n === 1 ? label : `${n} ${label}s`;
}

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  return apiClient.get<SubscriptionPlan[]>('/api/subscription/plans');
}

/** Public plans for the pre-login landing page (no auth required). */
export async function getPublicPlans(): Promise<SubscriptionPlan[]> {
  return apiClient.get<SubscriptionPlan[]>('/api/public/plans', { credentials: 'omit' });
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiClient.get<SubscriptionStatus>('/api/subscription/status');
}

export async function activateSubscription(planId: string): Promise<SubscriptionStatus> {
  return apiClient.post<SubscriptionStatus>('/api/subscriptions', { planId });
}
