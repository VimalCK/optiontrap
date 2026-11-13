import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { admin, requireAuth } from '../authMiddleware.js';
import { createFeedback, getFeedbackList, updateFeedbackStatus } from '../db.js';
import { FEEDBACK_STATUSES, isFeedbackStatus, isFeedbackType } from '../../shared/appEnums.js';
import { sendCreated, sendError, sendOk } from '../replies.js';

export const feedbackRoutes = asyncRouter();

feedbackRoutes.post('/api/feedback', requireAuth, async (req, res) => {
  const { type, message, pageUrl, userAgent } = req.body || {};

  if (!isFeedbackType(type)) {
    return sendError(res, 400, 'Valid feedback type is required');
  }

  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return sendError(res, 400, 'Feedback message must be at least 5 characters');
  }

  const feedback = await createFeedback({
    userId: req.session.kiteSession.userId,
    type,
    message: message.trim().slice(0, 4000),
    pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 1000) : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 1000) : req.get('user-agent'),
  });

  sendCreated(res, feedback);
});

feedbackRoutes.get('/api/admin/feedback', admin, withFailureMessage('Failed to load feedback', async (req, res) => {
  const { type, status } = req.query;

  if (type && !isFeedbackType(type)) {
    return sendError(res, 400, 'Invalid feedback type filter');
  }

  if (status && !isFeedbackStatus(status)) {
    return sendError(res, 400, 'Invalid feedback status filter');
  }

  sendOk(res, await getFeedbackList({ type: type || null, status: status || null }));
}));

feedbackRoutes.patch('/api/admin/feedback/:id', admin, withFailureMessage('Failed to update feedback', async (req, res) => {
  const { status } = req.body || {};

  if (!isFeedbackStatus(status)) {
    return sendError(res, 400, `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`);
  }

  const updated = await updateFeedbackStatus(req.params.id, status);
  if (!updated) return sendError(res, 404, 'Feedback not found');
  sendOk(res);
}));
