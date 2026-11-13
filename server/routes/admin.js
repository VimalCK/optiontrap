import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { admin } from '../authMiddleware.js';
import {
  adminActivateSubscription,
  adminCancelSubscription,
  adminExtendSubscription,
  getAdminUsers,
  getFeedbackCounts,
  getNewestOiSnapshotTimestamp,
  getScheduledJobRuns,
  getScheduledJobRunsByPrefix,
  getUsageStats,
  pingDb,
} from '../db.js';
import { NIGHTLY_JOB_PREFIX, nightlyJobsStatus } from '../nightlyJobs.js';
import { OI_HISTORY_JOB } from '../oiHistoryScheduler.js';
import { nightlyJobsHealth, tradeEngineHealth, unreadableHealth } from '../serviceHealth.js';
import { IS_PROD } from '../serverConfig.js';
import { tradeEngine } from '../tradeEngine/index.js';
import { SubscriptionAction } from '../../shared/appEnums.js';
import { sendError, sendOk } from '../replies.js';
import { SUBSCRIPTION_UPDATE_FAILED, subscriptionChange } from './subscriptions.js';
import { sendResult } from './sendResult.js';

// Admins need no subscription: they have full access.
export const adminRoutes = asyncRouter();

adminRoutes.get('/api/admin/scheduled-jobs/oi-history', admin, withFailureMessage('Failed to load scheduled job runs', async (_req, res) => {
  sendOk(res, await getScheduledJobRuns(OI_HISTORY_JOB, 14));
}));

adminRoutes.get('/api/admin/scheduled-jobs/nightly', admin, withFailureMessage('Failed to load nightly job runs', async (_req, res) => {
  sendOk(res, await getScheduledJobRunsByPrefix(NIGHTLY_JOB_PREFIX, 100));
}));

adminRoutes.get('/api/admin/health', admin, async (req, res) => {
  const dbConnected = await pingDb();

  // Gather metrics independently so a single failure doesn't blank the page.
  const [usage, feedback, lastOi, nightly] = await Promise.allSettled([
    getUsageStats(),
    getFeedbackCounts(),
    getNewestOiSnapshotTimestamp(),
    nightlyJobsStatus(),
  ]);

  const val = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
  const kite = req.session?.kiteSession;

  sendOk(res, {
    db: { connected: dbConnected },
    kite: {
      connected: Boolean(kite?.accessToken),
      userId: kite?.userId || null,
      userName: kite?.userName || null,
      loginTime: kite?.loginTime || null,
    },
    lastOiUpdate: val(lastOi, null),
    usage: val(usage, { activeSessions: 0, totalUsers: 0 }),
    feedback: val(feedback, { total: 0, open: 0 }),
    checks: {
      tradeEngine: tradeEngineHealth(tradeEngine.status()),
      nightlyJobs: nightly.status === 'fulfilled' ? nightlyJobsHealth(nightly.value) : unreadableHealth('job runs', nightly.reason),
    },
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      mode: IS_PROD ? 'production' : 'development',
    },
    timestamp: Date.now(),
  });
});

adminRoutes.get('/api/admin/users', admin, withFailureMessage('Failed to load users', async (_req, res) => {
  sendOk(res, await getAdminUsers());
}));

adminRoutes.post('/api/admin/users/:userId/subscription', admin, withFailureMessage(SUBSCRIPTION_UPDATE_FAILED, async (req, res) => {
  const { userId } = req.params;
  const { action, planId } = req.body || {};

  let change;
  if (action === SubscriptionAction.Activate) {
    if (!planId) return sendError(res, 400, 'planId is required');
    change = () => adminActivateSubscription(userId, planId);
  } else if (action === SubscriptionAction.Extend) {
    if (!planId) return sendError(res, 400, 'planId is required');
    change = () => adminExtendSubscription(userId, planId);
  } else if (action === SubscriptionAction.Cancel) {
    change = () => adminCancelSubscription(userId);
  } else {
    return sendError(res, 400, `action must be ${Object.values(SubscriptionAction).join(', ')}`);
  }

  const result = await subscriptionChange(change);
  sendResult(res, result, { data: result.subscription });
}));
