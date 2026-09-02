import { SubscriptionPlan, SubscriptionStatus } from './kiteAuth';

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }

  return json.data;
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
