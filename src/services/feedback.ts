export type FeedbackType = 'bug' | 'feature' | 'general' | 'subscription';

export interface FeedbackPayload {
  type: FeedbackType;
  message: string;
  pageUrl: string;
  userAgent: string;
}

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.message || `Failed to submit feedback (${res.status})`);
  }
}
