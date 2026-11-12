import { apiClient } from './apiClient';
import type { FeedbackTypeId } from '../../shared/appEnums.js';

export interface FeedbackPayload {
  type: FeedbackTypeId;
  message: string;
  pageUrl: string;
  userAgent: string;
}

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  await apiClient.post('/api/feedback', payload);
}
