import { ApiError, apiClient, responseErrorMessage } from './apiClient';
import type { ExportTableId, FeedbackStatusId, FeedbackTypeId } from '../../shared/appEnums.js';
import { type HealthStatusId } from '../../shared/appEnums.js';
import type { SubscriptionActionId } from '../../shared/appEnums.js';

export interface FeedbackItem {
  id: string;
  userId: string;
  userName: string | null;
  type: FeedbackTypeId;
  message: string;
  pageUrl: string | null;
  userAgent: string | null;
  status: FeedbackStatusId;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackFilters {
  type?: FeedbackTypeId | '';
  status?: FeedbackStatusId | '';
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


export async function getUsers(): Promise<AdminUser[]> {
  return apiClient.get<AdminUser[]>('/api/admin/users');
}

export async function updateUserSubscription(
  userId: string,
  action: SubscriptionActionId,
  planId?: string,
): Promise<void> {
  await apiClient.post(`/api/admin/users/${encodeURIComponent(userId)}/subscription`, { action, planId });
}

/** One service's health check (IETF health check format): Pass / Warn / Fail, why, and when it was observed (ISO, null when not yet). */
export interface HealthCheck {
  status: HealthStatusId;
  output: string;
  time: string | null;
}

export interface HealthReport {
  db: { connected: boolean };
  kite: { connected: boolean; userId: string | null; userName: string | null; loginTime: string | null };
  lastOiUpdate: number | null;
  usage: { activeSessions: number; totalUsers: number };
  feedback: { total: number; open: number };
  checks: { tradeEngine: HealthCheck; nightlyJobs: HealthCheck };
  server: { uptimeSeconds: number; mode: string };
  timestamp: number;
}

export async function getHealth(): Promise<HealthReport> {
  return apiClient.get<HealthReport>('/api/admin/health');
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatusId): Promise<void> {
  await apiClient.patch(`/api/admin/feedback/${id}`, { status });
}

/** A table an admin can download as a spreadsheet. */
export interface TableExport {
  id: ExportTableId;
  label: string;
  description: string;
}

export function getTableExports(signal?: AbortSignal): Promise<TableExport[]> {
  return apiClient.get<TableExport[]>('/api/admin/table-exports', { signal });
}

/** The file name a Content-Disposition header gives, or null without one. */
export function attachmentFileName(disposition: string | null): string | null {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : null;
}

/** Downloads one table as an .xlsx; throws ApiError with the server's message when it is refused. */
export async function downloadTableExport(table: ExportTableId, signal?: AbortSignal): Promise<{ blob: Blob; fileName: string }> {
  const response = await apiClient.raw(`/api/admin/table-exports/${encodeURIComponent(table)}`, { signal });
  if (!response.ok) throw new ApiError(await responseErrorMessage(response), response.status);
  const fileName = attachmentFileName(response.headers.get('content-disposition')) ?? `${table}.xlsx`;
  return { blob: await response.blob(), fileName };
}
