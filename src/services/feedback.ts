export type FeedbackType = 'bug' | 'feature' | 'general' | 'subscription';
import { apiClient } from './apiClient';

export interface FeedbackPayload {
  type: FeedbackType;
  message: string;
  pageUrl: string;
  userAgent: string;
}

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  await apiClient.post('/api/feedback', payload);
}
