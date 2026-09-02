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
