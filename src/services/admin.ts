import { FeedbackType } from './feedback';

export type FeedbackStatus = 'open' | 'reviewed' | 'resolved';

export interface FeedbackItem {
  id: string;
  userId: string;
  userName: string | null;
  type: FeedbackType;
  message: string;
  pageUrl: string | null;
  userAgent: string | null;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackFilters {
  type?: FeedbackType | '';
  status?: FeedbackStatus | '';
}

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }

  return json.data;
}

export async function getFeedback(filters: FeedbackFilters = {}): Promise<FeedbackItem[]> {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);

  const query = params.toString();
  const res = await fetch(`/api/admin/feedback${query ? `?${query}` : ''}`, {
    credentials: 'include',
  });

  return readJson<FeedbackItem[]>(res);
}

export interface AdminUser {
  userId: string;
  userName: string | null;
  isAdmin: boolean;
  lastLogin: string | null;
  feedbackCount: number;
  subscription: {
    status: string;
    active: boolean;
    planId: string | null;
    planName: string | null;
    expiresAt: string | null;
    durationCount: number | null;
    durationUnit: string | null;
  };
}

export type SubscriptionAction = 'activate' | 'extend' | 'cancel';

export async function getUsers(): Promise<AdminUser[]> {
  const res = await fetch('/api/admin/users', { credentials: 'include' });
  return readJson<AdminUser[]>(res);
}

export async function updateUserSubscription(
  userId: string,
  action: SubscriptionAction,
  planId?: string,
): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action, planId }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.message || `Failed to update subscription (${res.status})`);
  }
}

export interface HealthStatus {
  db: { connected: boolean };
  kite: { connected: boolean; userId: string | null; userName: string | null; loginTime: string | null };
  lastOiUpdate: number | null;
  usage: { activeSessions: number; totalUsers: number };
  feedback: { total: number; open: number };
  server: { uptimeSeconds: number; mode: string };
  timestamp: number;
}

export async function getHealth(): Promise<HealthStatus> {
  const res = await fetch('/api/admin/health', { credentials: 'include' });
  return readJson<HealthStatus>(res);
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  const res = await fetch(`/api/admin/feedback/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.message || `Failed to update feedback (${res.status})`);
  }
}
