import { SubscriptionPlan, SubscriptionStatus } from './kiteAuth';

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }

  return json.data;
}

/**
 * Human-readable duration label from the generic count + unit model.
 * e.g. (1, 'month') -> "month", (6, 'month') -> "6 months", (7, 'day') -> "7 days".
 */
export function formatDuration(count: number, unit: string): string {
  const n = count || 1;
  return n === 1 ? unit : `${n} ${unit}s`;
}

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const res = await fetch('/api/subscription/plans', { credentials: 'include' });
  return readJson<SubscriptionPlan[]>(res);
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await fetch('/api/subscription/status', { credentials: 'include' });
  return readJson<SubscriptionStatus>(res);
}

export async function activateSubscription(planId: string): Promise<SubscriptionStatus> {
  const res = await fetch('/api/subscription/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ planId }),
  });

  return readJson<SubscriptionStatus>(res);
}
