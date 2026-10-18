import { FeedbackType } from './feedback';
import { apiClient } from './apiClient';

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

export async function getFeedback(filters: FeedbackFilters = {}): Promise<FeedbackItem[]> {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);

  const query = params.toString();
  return apiClient.get<FeedbackItem[]>(`/api/admin/feedback${query ? `?${query}` : ''}`);
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
  return apiClient.get<AdminUser[]>('/api/admin/users');
}

export async function updateUserSubscription(
  userId: string,
  action: SubscriptionAction,
  planId?: string,
): Promise<void> {
  await apiClient.post(`/api/admin/users/${encodeURIComponent(userId)}/subscription`, { action, planId });
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
  return apiClient.get<HealthStatus>('/api/admin/health');
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  await apiClient.patch(`/api/admin/feedback/${id}`, { status });
}
