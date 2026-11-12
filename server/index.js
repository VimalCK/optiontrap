/**
 * OptionTrap Backend Server
 *
 * Multi-user server. Credentials (apiKey + apiSecret) are stored ONLY in
 * the client browser's localStorage — the server never persists them.
 * They are sent during OAuth token exchange and immediately discarded.
 *
 * Endpoints:
 *   GET  /auth/status      — session active?
 *   GET  /auth/login-url   — Kite OAuth URL (apiKey from query param)
 *   POST /auth/token       — exchange request_token (apiKey + apiSecret from body)
 *   POST /auth/logout      — invalidate session
 *   GET  /auth/me          — current session info
 *   ALL  /api/*            — proxy to api.kite.trade with per-user auth
 *   WS   /ws               — proxy to wss://ws.kite.trade with per-user auth
 */

import 'dotenv/config';

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readKiteBody } from './kiteErrors.js';
import { KITE_API_URL, KiteApiError, kiteClient, kiteHeaders } from './kiteClient.js';
import { KITE_LOGIN_ENDED, isKiteAuthFailure } from '../shared/kiteAuth.js';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  initDb,
  closeDb,
  upsertUser,
  deleteUser,
  getActiveSubscriptionPlans,
  getUserSubscription,
  activateSubscription,
  isUserAdmin,
  createFeedback,
  getFeedbackList,
  updateFeedbackStatus,
  getFeedbackCounts,
  pingDb,
  getUsageStats,
  getAdminUsers,
  adminActivateSubscription,
  adminExtendSubscription,
  adminCancelSubscription,
  SubscriptionPlanNotFoundError,
  createWatchlist,
  getWatchlists,
  getWatchlistItems,
  renameWatchlist,
  deleteWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  reorderWatchlistItems,
  getPriceAlerts,
  createPriceAlert,
  triggerPriceAlert,
  resetPriceAlert,
  deletePriceAlert,
  getAutoTrades,
  getAutoTradeResults,
  getOrders,
  getUserOpenOrders,
  getPositions,
  getDailyPnl,
  getPositionStats,
  getTodayOiSnapshots,
  getLatestOiSnapshotTimestamp,
  getNewestOiSnapshotTimestamp,
  getOiHistoryDataByExpiryMonth,
  getOiHistoryFuturesData,
  saveTradeSetupSignal,
  getTradeSetupSignals,
  updateTradeSetupSignalOutcome,
  evaluateTradeSetupSignalOutcomes,
  getScheduledJobRuns,
  getScheduledJobRunsByPrefix,
  deleteTradeSetupSignal,
  getStoredOiHistoryExpiryMonths,
  deleteOiHistoryByMonth,
  deleteOiHistoryByExpiryMonth,
  getFnoSymbols,
  getUnderlyings,
  getMarketReference,
  setAlwaysSnapshot,
  deleteOiHistoryByScrip,
  getCashStock,
  getStockCandles,
  getStockScansForUser,
  getStockSetupStats,
  getStockSetupSignals,
} from './db.js';
import { parsePriceAlertInput } from './priceAlerts.js';
import { parseAutomationConfig } from '../shared/automation.js';
import { PostgresSessionStore } from './sessionStore.js';
import { clientIp, createRateLimiter } from './rateLimit.js';
import { cached } from './cache.js';
import { getOrFetchInstruments } from './instruments.js';
import { fetchOiHistoryMonth, OiHistoryFetchError, todayIST } from './oiHistoryFetch.js';
import { OI_HISTORY_JOB } from './oiHistoryScheduler.js';
import { watchOiSnapshotSymbol } from './oiSnapshotScheduler.js';
import { SUBSCRIPTION_REQUIRED, checkSubscriptionAccess, inactiveSubscription } from './subscriptionAccess.js';
import { backfillStockSetups, candleSyncWarning, scanStock, syncStockCandles } from './stockCandles.js';
import { NIGHTLY_JOB_PREFIX, nightlyJobsStatus } from './nightlyJobs.js';
import { tradeEngine } from './tradeEngine/index.js';
import { scheduledJobs } from './scheduledJobs.js';
import { getAutomationConfig, saveAutomationConfig } from './tradeEngine/automationConfigs.js';
import { strategyInfos } from './tradeEngine/strategies/index.js';
import { nightlyJobsHealth, tradeEngineHealth, unreadableHealth } from './serviceHealth.js';
import { parseDailyPnlQuery, parsePositionsQuery, parseRange, parseStatsQuery } from './positionsQuery.js';
import { catchAsyncErrors, sendFailure, sendServerError } from './asyncRoutes.js';
import { securityHeaders } from './securityHeaders.js';
import { startLoggedInSession } from './loginSession.js';
import { kiteLoginUrl } from './kiteLogin.js';
import { signedSessionId } from './wsSessionCookie.js';
import { isSameSiteWsOrigin } from './wsOrigin.js';
import { kiteTickerUrl } from './kiteTickerFeed.js';
import { resolveSessionSecret } from './sessionSecret.js';
import { createConcurrencyLimit } from './concurrencyLimit.js';
import { allowOnlyKnownKiteCalls } from './kiteProxyAllowlist.js';
import { MAX_CLIENT_MESSAGE_BYTES, MAX_CONNECTIONS_PER_USER } from './wsLimits.js';
import { Exchange, OrderStatus, isOptionType, isSide } from '../shared/tradeEnums.js';
import { AccessDenial, FEEDBACK_STATUSES, FetchEvent, PriceAlertStatus, SignalOutcome, StrikeMode, SubscriptionAction, SubscriptionProvider, isFeedbackStatus, isFeedbackType, strikeModeFrom } from '../shared/appEnums.js';
import { TradeSetupStatus, isTradeSetupStatus } from '../shared/analysisEnums.js';
import { sendCreated, sendError, sendOk } from './replies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';
const sessionSecret = resolveSessionSecret({ secret: process.env.SESSION_SECRET, isProd: IS_PROD });
if (sessionSecret.error) throw new Error(sessionSecret.error);
const SESSION_SECRET = sessionSecret.value;
const APP_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local').slice(0, 7);

// ---------- Log colours ----------

const GREY = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function ts() {
  return `${GREY}${new Date().toLocaleTimeString()}${RESET}`;
}

// ---------- Express App ----------

const app = express();
const server = createServer(app);
catchAsyncErrors(app);

const accessDeps = { getUserSubscription, isUserAdmin };

async function getSubscriptionSummary(userId) {
  const subscription = await getUserSubscription(userId);

  return subscription || inactiveSubscription;
}

async function getSafeSession(kiteSession) {
  if (!kiteSession) return null;

  const { accessToken, apiKey, ...safe } = kiteSession;
  // Read the role live from the DB so the client reflects admin status
  // immediately, even for sessions created before the flag existed.
  safe.isAdmin = await isUserAdmin(kiteSession.userId);
  safe.subscription = await getSubscriptionSummary(kiteSession.userId);

  return safe;
}

if (IS_PROD) {
  app.set('trust proxy', 1);
}

const sessionStore = new PostgresSessionStore();

const sessionMiddleware = session({
  store: sessionStore,
  name: 'optiontrap_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
});

// ---------- Middleware ----------

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cookieParser(SESSION_SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: IS_PROD ? false : FRONTEND_ORIGIN,
  credentials: true,
}));

app.use(sessionMiddleware);

// ---------- Rate Limiting ----------
// Three tiers: auth (strict), API proxy (per-user), general (catch-all)

// Auth endpoints: 10 requests/minute per IP — brute-force protection
const authLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: 'Too many authentication attempts, please try again in a minute',
});

// API proxy: 120 requests/minute per user — stay below Kite's 3/sec limit
const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => req.session?.kiteSession?.userId || clientIp(req),
  message: 'API rate limit exceeded, please slow down',
});

// General: 200 requests/minute per IP — DDoS baseline
const generalLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 200,
});

app.use(generalLimiter);
app.use('/auth', authLimiter);

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? RED : status >= 400 ? YELLOW : status >= 300 ? CYAN : GREEN;
    const user = req.session?.kiteSession?.userId || '-';
    console.log(
      `${ts()} ${color}${status}${RESET} ${method} ${originalUrl} ${GREY}${duration}ms [${user}]${RESET}`,
    );
  });

  next();
});

// ---------- Auth Routes ----------

// Session status check
app.get('/auth/status', (req, res) => {
  const activeSession = req.session?.kiteSession || null;

  if (activeSession) {
    getSafeSession(activeSession)
      .then((safe) => sendOk(res, safe, { authenticated: true }))
      .catch((err) => {
        console.error(`${ts()} ${RED}AUTH${RESET} status error:`, err);
        sendError(res, 500, 'Failed to load auth status');
      });
  } else {
    sendOk(res, null, { authenticated: false });
  }
});

// Get Kite OAuth login URL — apiKey comes from client (stored in localStorage)
app.get('/auth/login-url', (req, res) => {
  const { url, error } = kiteLoginUrl(req.query.api_key);
  if (error) return sendError(res, 400, error);
  sendOk(res, { url });
});

// Check session (backward compat with useKiteSession)
app.get('/auth/me', (req, res) => {
  if (req.session?.kiteSession) {
    getSafeSession(req.session.kiteSession)
      .then((safe) => sendOk(res, safe))
      .catch((err) => {
        console.error(`${ts()} ${RED}AUTH${RESET} me error:`, err);
        sendError(res, 500, 'Failed to load session');
      });
  } else {
    sendError(res, 401, 'Not authenticated');
  }
});

// Exchange request_token for access_token
// Credentials come from client body (stored in browser localStorage)
app.post('/auth/token', async (req, res) => {
  const { request_token, apiKey, apiSecret } = req.body;

  if (!request_token || !apiKey || !apiSecret) {
    return sendError(res, 400, 'request_token, apiKey, and apiSecret are required');
  }

  // Clear any stale session before exchanging a new token
  if (req.session?.kiteSession) {
    delete req.session.kiteSession;
    await new Promise((resolve) => req.session.save(resolve));
  }

  try {
    console.log(`${ts()} ${CYAN}AUTH${RESET} token exchange for ${apiKey.slice(0, 4)}...`);

    const checksumInput = apiKey + request_token + apiSecret;
    const checksum = crypto.createHash('sha256').update(checksumInput).digest('hex');

    let data;
    try {
      data = await kiteClient().postForm('/session/token', { api_key: apiKey, request_token, checksum });
    } catch (err) {
      if (!(err instanceof KiteApiError)) throw err;
      console.error(`${ts()} ${RED}AUTH${RESET} exchange failed: ${err.status} ${err.message}`);
      return sendError(res, err.status, err.kiteMessage ?? `Kite token exchange failed (${err.status})`);
    }

    // 1. Record user identity (no credentials stored)
    await upsertUser(data.user_id, data.user_name);

    // 2. Resolve role (admins bypass subscription and unlock the admin inbox)
    const isAdmin = await isUserAdmin(data.user_id);

    // 3. Start the logged-in session under a new session ID (see loginSession.js)
    const kiteSession = {
      apiKey,
      accessToken: data.access_token,
      userId: data.user_id,
      userName: data.user_name,
      userShortname: data.user_shortname,
      email: data.email,
      broker: data.broker,
      loginTime: data.login_time,
      avatarUrl: data.avatar_url || null,
      isAdmin,
    };

    const safe = await getSafeSession(kiteSession);
    await startLoggedInSession(req, kiteSession);
    console.log(`${ts()} ${GREEN}AUTH${RESET} logged in: ${data.user_id} (${data.user_name})`);
    sendOk(res, safe);
  } catch (err) {
    sendFailure(res, err, { log: `${ts()} ${RED}AUTH${RESET} exchange error`, message: 'Login failed on the server · try again' });
  }
});

// Logout — destroy session (credentials remain in browser localStorage)
app.post('/auth/logout', async (req, res) => {
  const kiteSession = req.session?.kiteSession;

  if (kiteSession?.apiKey && kiteSession?.accessToken) {
    try {
      await kiteClient(kiteSession).delete('/session/token');
    } catch {
      // Ignore Kite-side errors on logout
    }
  }

  req.session.destroy(() => {
    res.clearCookie('optiontrap_sid');
    sendOk(res);
  });
});

// Delete account — remove user, destroy session
app.delete('/auth/account', async (req, res) => {
  const kiteSession = req.session?.kiteSession;
  const userId = kiteSession?.userId;

  if (!userId) {
    return sendError(res, 400, 'No account found to delete');
  }

  // Invalidate Kite token if we have one
  if (kiteSession?.accessToken) {
    kiteClient(kiteSession).delete('/session/token').catch(() => {}); // Kite-side errors don't stop the deletion
  }

  // Delete user
  await deleteUser(userId);

  // Destroy session
  req.session.destroy(() => {
    res.clearCookie('optiontrap_sid');
    console.log(`${ts()} ${RED}AUTH${RESET} account deleted: ${userId}`);
    sendOk(res);
  });
});

// ---------- Auth guard ----------

const requireAuth = (req, res, next) => {
  if (!req.session?.kiteSession?.apiKey) {
    return sendError(res, 401, 'Not authenticated');
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  const userId = req.session?.kiteSession?.userId;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated');
  }

  try {
    // Authoritative check against the DB (live), not the cached session flag —
    // so role changes take effect without requiring the user to log in again.
    if (!(await isUserAdmin(userId))) {
      return sendError(res, 403, 'Admin access required');
    }
    next();
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} guard error:`, err);
    sendError(res, 500, 'Failed to verify admin access');
  }
};

const requireSubscription = async (req, res, next) => {
  try {
    const access = await checkSubscriptionAccess(req.session?.kiteSession?.userId, accessDeps);

    if (access.allowed) {
      req.subscription = access.subscription;
      return next();
    }

    if (access.reason === AccessDenial.Unauthenticated) {
      return sendError(res, 401, 'Not authenticated');
    }

    return sendError(res, 402, 'An active subscription is required', { code: SUBSCRIPTION_REQUIRED, data: access.subscription });
  } catch (err) {
    console.error(`${ts()} ${RED}SUBSCRIPTION${RESET} gate error:`, err);
    sendError(res, 500, 'Failed to verify subscription');
  }
};

// Public: active plans for the pre-login landing page (no auth, no secrets).
// Cached in memory for 30 minutes — plans change rarely, and this shields the
// DB from unauthenticated traffic floods (single-flight prevents stampedes).
const getCachedPlans = cached(getActiveSubscriptionPlans, 30 * 60_000);

app.get('/api/version', (_req, res) => {
  sendOk(res, { version: APP_VERSION });
});

app.get('/api/public/plans', async (_req, res) => {
  try {
    const plans = await getCachedPlans();
    sendOk(res, plans);
  } catch (err) {
    console.error(`${ts()} ${RED}PLANS${RESET} public plans error:`, err);
    sendError(res, 500, 'Failed to load plans');
  }
});

app.get('/api/subscription/plans', requireAuth, async (_req, res) => {
  const plans = await getActiveSubscriptionPlans();
  sendOk(res, plans);
});

app.get('/api/subscription/status', requireAuth, async (req, res) => {
  const subscription = await getSubscriptionSummary(req.session.kiteSession.userId);
  sendOk(res, subscription);
});

/** Reply to a failed subscription change: 400 for an unknown plan, otherwise a generic 500. */
const sendSubscriptionFailure = (res, err, log) => {
  if (err instanceof SubscriptionPlanNotFoundError) return sendError(res, 400, err.message);
  sendFailure(res, err, { log, message: 'Failed to update the subscription' });
};

// Activate a plan for the signed-in user: creates a subscription.
app.post('/api/subscriptions', requireAuth, async (req, res) => {
  const { planId } = req.body || {};

  try {
    const subscription = await activateSubscription(req.session.kiteSession.userId, planId, SubscriptionProvider.Internal);
    sendCreated(res, subscription);
  } catch (err) {
    sendSubscriptionFailure(res, err, '[Subscription] activate error');
  }
});

app.post('/api/feedback', requireAuth, async (req, res) => {
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

// ---------- Admin Routes ----------
// Auth + admin role required. No subscription needed — admins have full access.

// Recent runs of the after-close OI history fetch, newest first.
app.get('/api/admin/scheduled-jobs/oi-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    sendOk(res, await getScheduledJobRuns(OI_HISTORY_JOB, 14));
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} scheduled job runs error:`, err);
    sendError(res, 500, 'Failed to load scheduled job runs');
  }
});

// Recent runs of the nightly jobs (server/jobs/nightly/), newest first.
app.get('/api/admin/scheduled-jobs/nightly', requireAuth, requireAdmin, async (req, res) => {
  try {
    sendOk(res, await getScheduledJobRunsByPrefix(NIGHTLY_JOB_PREFIX, 100));
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} nightly job runs error:`, err);
    sendError(res, 500, 'Failed to load nightly job runs');
  }
});

app.get('/api/admin/feedback', requireAuth, requireAdmin, async (req, res) => {
  const { type, status } = req.query;

  if (type && !isFeedbackType(type)) {
    return sendError(res, 400, 'Invalid feedback type filter');
  }

  if (status && !isFeedbackStatus(status)) {
    return sendError(res, 400, 'Invalid feedback status filter');
  }

  try {
    const feedback = await getFeedbackList({ type: type || null, status: status || null });
    sendOk(res, feedback);
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} feedback list error:`, err);
    sendError(res, 500, 'Failed to load feedback');
  }
});

app.patch('/api/admin/feedback/:id', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};

  if (!isFeedbackStatus(status)) {
    return sendError(res, 400, `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`);
  }

  try {
    const updated = await updateFeedbackStatus(req.params.id, status);

    if (!updated) {
      return sendError(res, 404, 'Feedback not found');
    }

    sendOk(res);
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} feedback update error:`, err);
    sendError(res, 500, 'Failed to update feedback');
  }
});

app.get('/api/admin/health', requireAuth, requireAdmin, async (req, res) => {
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

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await getAdminUsers();
    sendOk(res, users);
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} users list error:`, err);
    sendError(res, 500, 'Failed to load users');
  }
});

app.post('/api/admin/users/:userId/subscription', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { action, planId } = req.body || {};

  try {
    let subscription;
    if (action === SubscriptionAction.Activate) {
      if (!planId) return sendError(res, 400, 'planId is required');
      subscription = await adminActivateSubscription(userId, planId);
    } else if (action === SubscriptionAction.Extend) {
      if (!planId) return sendError(res, 400, 'planId is required');
      subscription = await adminExtendSubscription(userId, planId);
    } else if (action === SubscriptionAction.Cancel) {
      subscription = await adminCancelSubscription(userId);
    } else {
      return sendError(res, 400, `action must be ${Object.values(SubscriptionAction).join(', ')}`);
    }

    sendOk(res, subscription);
  } catch (err) {
    sendSubscriptionFailure(res, err, `${ts()} ${RED}ADMIN${RESET} subscription update error`);
  }
});

// ---------- Watchlist Routes ----------

app.get('/api/watchlists', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const lists = await getWatchlists(userId);
  sendOk(res, lists);
});

app.get('/api/watchlists/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const list = await getWatchlistItems(req.params.id, userId);

  if (!list) {
    return sendError(res, 404, 'Watchlist not found');
  }

  sendOk(res, list);
});

app.post('/api/watchlists', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { name } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    return sendError(res, 400, 'Watchlist name is required');
  }

  const list = await createWatchlist(userId, name);
  sendCreated(res, list);
});

// Rename (the only field a watchlist has to change).
app.patch('/api/watchlists/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { name } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    return sendError(res, 400, 'Name is required');
  }

  const updated = await renameWatchlist(req.params.id, userId, name);
  if (!updated) {
    return sendError(res, 404, 'Watchlist not found');
  }

  sendOk(res);
});

app.delete('/api/watchlists/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const deleted = await deleteWatchlist(req.params.id, userId);

  if (!deleted) {
    return sendError(res, 404, 'Watchlist not found');
  }

  sendOk(res);
});

app.post('/api/watchlists/:id/items', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { instrumentToken, tradingsymbol, exchange } = req.body;

  if (!instrumentToken || !tradingsymbol) {
    return sendError(res, 400, 'instrumentToken and tradingsymbol are required');
  }

  const item = await addWatchlistItem(req.params.id, userId, {
    instrumentToken: Number(instrumentToken),
    tradingsymbol,
    exchange: exchange || Exchange.NSE,
  });

  if (!item) {
    return sendError(res, 400, 'Limit reached (100), duplicate instrument, or watchlist not found');
  }

  sendCreated(res, item);
});

// Save the order of a watchlist's items after the user drags one to a new position.
app.put('/api/watchlists/:id/items/order', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) {
    return sendError(res, 400, 'itemIds must be a list of item ids');
  }

  try {
    const saved = await reorderWatchlistItems(req.params.id, userId, itemIds);
    if (!saved) {
      return sendError(res, 400, 'Watchlist not found, or the items changed: reload and try again');
    }
    sendOk(res);
  } catch (err) {
    sendFailure(res, err, { log: '[Watchlist] Reorder error', message: 'Failed to save the watchlist order' });
  }
});

app.delete('/api/watchlists/:id/items/:itemId', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const removed = await removeWatchlistItem(req.params.itemId, userId);

  if (!removed) {
    return sendError(res, 404, 'Item not found');
  }

  sendOk(res);
});

// ---------- Trade automation ----------

app.get('/api/automation/config', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  sendOk(res, await getAutomationConfig(userId));
});

app.put('/api/automation/config', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { config, error } = parseAutomationConfig(req.body, strategyInfos());
  if (error) return sendError(res, 400, error);
  const saved = await saveAutomationConfig(userId, config);
  await tradeEngine.services.tradeMonitor.refreshUser(userId); // new exit rules apply from the next tick
  sendOk(res, saved);
});

// The trade engine's strategies, as the Automation page shows and configures them.
app.get('/api/strategies', requireAuth, requireSubscription, (req, res) => {
  sendOk(res, strategyInfos());
});

// The automated trades created in ?from=…&to=… (market days, both required), each with its lifecycle.
app.get('/api/automation/trades', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const range = parseRange(req.query.from, req.query.to, { required: true });
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getAutoTrades(userId, range));
});

// Win/Loss Patterns: closed automated trades entered in ?from=…&to=… (market days, both required), measured and grouped.
app.get('/api/automation/results', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const range = parseRange(req.query.from, req.query.to, { required: true });
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getAutoTradeResults(userId, range));
});

// ---------- Price alerts ----------

app.get('/api/price-alerts', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  sendOk(res, await getPriceAlerts(userId));
});

app.post('/api/price-alerts', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { alert, error } = parsePriceAlertInput(req.body);
  if (error) return sendError(res, 400, error);

  sendCreated(res, await createPriceAlert(userId, alert));
});

// Change an alert's status:
//   { status: 'Triggered', price }  the browser saw a tick cross the alert's price
//   { status: 'Active' }            re-arm a triggered alert
// (PriceAlertStatus in shared/appEnums.js)
app.patch('/api/price-alerts/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { status } = req.body || {};

  if (status === PriceAlertStatus.Triggered) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return sendError(res, 400, 'price must be above 0');
    }
    const alert = await triggerPriceAlert(req.params.id, userId, price);
    if (!alert) return sendError(res, 404, 'Active alert not found');
    return sendOk(res, alert);
  }

  if (status === PriceAlertStatus.Active) {
    const alert = await resetPriceAlert(req.params.id, userId);
    if (!alert) return sendError(res, 404, 'Alert not found');
    return sendOk(res, alert);
  }

  sendError(res, 400, `status must be '${PriceAlertStatus.Triggered}' or '${PriceAlertStatus.Active}'`);
});

app.delete('/api/price-alerts/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const deleted = await deletePriceAlert(req.params.id, userId);
  if (!deleted) return sendError(res, 404, 'Alert not found');
  sendOk(res);
});

// ---------- Positions ----------

app.get('/api/positions', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { filter, error } = parsePositionsQuery(req.query);
  if (error) return sendError(res, 400, error);
  const positions = await getPositions(userId, filter);
  sendOk(res, positions);
});

app.get('/api/positions/daily-pnl', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { filter, error } = parseDailyPnlQuery(req.query);
  if (error) return sendError(res, 400, error);
  sendOk(res, await getDailyPnl(userId, filter));
});

app.get('/api/positions/stats', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { filter, error } = parseStatsQuery(req.query);
  if (error) return sendError(res, 400, error);
  sendOk(res, await getPositionStats(userId, filter));
});

// ---------- Orders (the trade engine's order service, server/tradeEngine/services/orders.js) ----------

// Every paper trade, manual or automated, entry or exit, is an order through the order
// service, which applies shared/paperOrders.js and shared/paperTradeRules.js.
// NO_PRICE: Kite gave no last price to price the order with.
const ORDER_HTTP_STATUS = { INVALID_TRADE: 400, MARKET_CLOSED: 409, NOT_FOUND: 404, NO_PRICE: 502 };

/** Reply with an order result: the order, or the refusal with its status. */
const sendOrderResult = (res, result, sendSuccess = sendOk) => {
  if (result.ok) return sendSuccess(res, result.order);
  return sendError(res, ORDER_HTTP_STATUS[result.code] ?? 400, result.message, { code: result.code });
};

// The user's orders, newest first: ?status=Open for every open one (whenever it
// was placed), else those placed in ?from=…&to=… (market days, both required).
app.get('/api/orders', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  if (req.query.status !== undefined) {
    if (req.query.status !== OrderStatus.Open) return sendError(res, 400, `status must be '${OrderStatus.Open}'`);
    return sendOk(res, await getUserOpenOrders(userId));
  }
  const range = parseRange(req.query.from, req.query.to, { required: true });
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getOrders(userId, range));
});

// Place an order: 201 with the order. A body with positionId exits that open position: a
// market order for its whole quantity, filled at once at the bid / ask (exitPrice when the
// quote has none), recording the position's charges. Otherwise a limit or market order,
// filled at once when it can fill now (market hours only), else open; positional orders can
// be placed while the market is closed. Quotes use the user's own Kite session.
app.post('/api/orders', requireAuth, requireSubscription, async (req, res) => {
  const { userId, apiKey, accessToken } = req.session.kiteSession;
  const body = req.body || {};
  const kite = { apiKey, accessToken };
  const { orders } = tradeEngine.services;
  try {
    const result = body.positionId !== undefined
      ? await orders.exit(userId, String(body.positionId), { exitPrice: body.exitPrice, kite })
      : await orders.place(userId, body, kite);
    sendOrderResult(res, result, sendCreated);
  } catch (err) {
    sendFailure(res, err, { log: '[Orders] POST error', message: 'Failed to place the order' });
  }
});

// Cancel an open order: the only change an order takes, { status: 'Cancelled' }.
app.patch('/api/orders/:id', requireAuth, requireSubscription, async (req, res) => {
  if (req.body?.status !== OrderStatus.Cancelled) return sendError(res, 400, `status must be '${OrderStatus.Cancelled}'`);
  sendOrderResult(res, await tradeEngine.services.orders.cancel(req.session.kiteSession.userId, req.params.id));
});

// ---------- OI Snapshots (shared) ----------

app.get('/api/oi-snapshots', requireAuth, requireSubscription, async (req, res) => {
  try {
    const snapshots = await getTodayOiSnapshots();
    sendOk(res, snapshots);
  } catch (err) {
    sendFailure(res, err, { log: '[OI Snapshots] GET error', message: 'Failed to load OI snapshots' });
  }
});

app.get('/api/oi-snapshots/latest', requireAuth, requireSubscription, async (req, res) => {
  try {
    const timestamp = await getLatestOiSnapshotTimestamp();
    sendOk(res, { timestamp });
  } catch (err) {
    sendFailure(res, err, { log: '[OI Snapshots] GET latest error', message: 'Failed to load the latest OI snapshot time' });
  }
});

// Snapshot a symbol's option chain for the rest of today (the always-snapshot
// symbols always are). The analyzer calls this when a symbol is opened; the first
// snapshot is taken before responding so the chart has data straight away.
app.post('/api/oi-snapshots/watched-symbols', requireAuth, requireSubscription, async (req, res) => {
  const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9&_-]{1,30}$/.test(symbol)) {
    return sendError(res, 400, 'A valid symbol is required');
  }
  try {
    sendOk(res, await watchOiSnapshotSymbol(symbol));
  } catch (err) {
    console.error(`[OI Snapshots] watch ${symbol} error:`, err.message);
    sendError(res, 500, 'Failed to start snapshots for this symbol');
  }
});

// ---------- OI History (historical daily OI) ----------

/**
 * POST /api/oi-history/fetch — Fetch historical daily OI candles from Kite.
 * Fetches missing dates from the current month and always refreshes today.
 * Streams progress via Server-Sent Events (SSE).
 * Body: { scrip: 'NIFTY', expiryMonth: 'YYYY-MM' }
 *
 * SSE events:
 *   step     — { step, message }
 *   progress — { done, total, pct, batch, totalBatches, symbol }
 *   done     — { rowCount, tradingDays, skippedDays, fetchedDays, uniqueTokens }
 *   error    — { message }
 *
 * One fetch at a time per user (429 otherwise): each makes many Kite calls and
 * large writes, and the OI History page runs its months one after another.
 */
const oiHistoryFetches = createConcurrencyLimit(1);

app.post('/api/oi-history/fetch', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  if (!oiHistoryFetches.tryAcquire(userId)) {
    return sendError(res, 429, 'An OI history fetch is already running · wait for it to finish');
  }
  try {
    await streamOiHistoryFetch(req, res);
  } finally {
    oiHistoryFetches.release(userId);
  }
});

/** Run one OI history fetch, streaming its progress to `res` as SSE. */
async function streamOiHistoryFetch(req, res) {
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // The browser cancels the request when the user leaves the OI History tab.
  // Stop calling Kite and skip the save — a partial save would mark those
  // dates as already fetched and leave gaps on the next fetch.
  const cancel = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) cancel.abort();
  });

  try {
    const { scrip, expiryMonth, strikeMode = StrikeMode.AtmRange, specificStrike } = req.body;
    const { apiKey, accessToken } = req.session.kiteSession;
    const summary = await fetchOiHistoryMonth({
      scrip, expiryMonth, strikeMode: strikeModeFrom(strikeMode), specificStrike, apiKey, accessToken, send, signal: cancel.signal,
    });

    // New prices may settle open signals; score them before the client reloads.
    try {
      await evaluateTradeSetupSignalOutcomes(scrip);
    } catch (err) {
      console.warn('[OI History] Signal outcome evaluation failed:', err.message);
    }

    send(FetchEvent.Done, summary);
    res.end();
  } catch (err) {
    if (cancel.signal.aborted) {
      console.log(`[OI History] Fetch cancelled by client for ${req.body?.scrip} ${req.body?.expiryMonth}`);
      return;
    }
    if (err.authFailure) {
      send(FetchEvent.Error, { message: 'Your Kite login has ended · log in again', code: KITE_LOGIN_ENDED });
      return res.end();
    }
    if (err instanceof OiHistoryFetchError) {
      send(FetchEvent.Error, { message: err.message });
      return res.end();
    }
    console.error('[OI History] Fetch error:', err);
    send(FetchEvent.Error, { message: 'OI history fetch failed on the server' });
    res.end();
  }
}

/**
 * GET /api/oi-history/expiry-months?scrip=NIFTY
 * Returns list of future expiry months available in current instruments.
 */
app.get('/api/oi-history/expiry-months', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip } = req.query;
    if (!scrip) {
      return sendError(res, 400, 'scrip is required');
    }

    const { apiKey, accessToken } = req.session.kiteSession;
    const instruments = await getOrFetchInstruments(apiKey, accessToken);
    const minExpiryDate = todayIST();
    const liveMonths = [...new Set(
      instruments
        .filter((inst) =>
          inst.name === scrip &&
          inst.exchange === Exchange.NFO &&
          isOptionType(inst.instrumentType) &&
          inst.expiry &&
          inst.expiry >= minExpiryDate
        )
        .map((inst) => inst.expiry.slice(0, 7))
        .sort(),
    )].slice(0, 3);

    const months = [...new Set([
      ...await getStoredOiHistoryExpiryMonths(scrip),
      ...liveMonths,
    ])].sort();
    sendOk(res, months);
  } catch (err) {
    sendFailure(res, err, { log: '[OI History] Expiry months error', message: 'Failed to load expiry months' });
  }
});

/**
 * GET /api/oi-history?scrip=NIFTY&expiryMonth=YYYY-MM[&from=YYYY-MM-DD]
 * Returns stored OI history data for one expiry month. The month is required, so
 * a request can't read a scrip's whole stored history at once.
 */
app.get('/api/oi-history', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, from, expiryMonth } = req.query;
    if (!scrip || !expiryMonth) {
      return sendError(res, 400, 'scrip and expiryMonth are required');
    }
    const data = await getOiHistoryDataByExpiryMonth(scrip, expiryMonth, from || null);
    sendOk(res, data);
  } catch (err) {
    sendFailure(res, err, { log: '[OI History] GET error', message: 'Failed to load OI history' });
  }
});

app.get('/api/oi-history/futures', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, expiryMonth, from } = req.query;
    if (!scrip || !expiryMonth) return sendError(res, 400, 'scrip and expiryMonth are required');
    const data = await getOiHistoryFuturesData(scrip, expiryMonth, from || null);
    sendOk(res, data);
  } catch (err) {
    sendFailure(res, err, { log: '[OI History] Futures GET error', message: 'Failed to load futures OI history' });
  }
});

// ---------- Watchlist stock setups ----------

/** Candles as compact [date, open, high, low, close, volume] rows: about half the JSON of objects. */
const compactCandles = (candles) => candles.map((c) => [c.date, c.open, c.high, c.low, c.close, c.volume]);

// One stock's stored daily candles plus the market reference index's (none when
// no index is marked is_market_reference), brought up to date with the user's
// own Kite session first. If Kite fails but candles are stored, they are
// returned with a warning rather than an error.
app.get('/api/stocks/:token/candles', requireAuth, requireSubscription, async (req, res) => {
  try {
    const token = Number(req.params.token);
    const stock = Number.isInteger(token) ? await getCashStock(token) : null;
    if (!stock) return sendError(res, 400, 'Entry and exit zones cover NSE and BSE cash stocks only');

    const kite = req.session.kiteSession;
    let warning = null;
    let synced = false;
    const reference = await getMarketReference();
    try {
      if (reference) await syncStockCandles(reference.instrumentToken, kite);
      const sync = await syncStockCandles(token, kite);
      synced = !sync.skipped;
    } catch (err) {
      console.warn(`[Stocks] Candle sync failed for ${stock.tradingsymbol}:`, err.message);
      warning = candleSyncWarning(err);
    }

    const [candles, market] = await Promise.all([getStockCandles(token), reference ? getStockCandles(reference.instrumentToken) : []]);
    if (!candles.length) {
      const message = warning ? `Couldn't load daily candles from Kite (${warning})` : 'Kite returned no daily candles for this stock';
      return sendError(res, 502, message);
    }
    // Keep the watchlist's Setups column in step with what the panel shows.
    if (synced) await scanStock(stock, market).catch((err) => console.warn(`[Stocks] Scan failed for ${stock.tradingsymbol}:`, err.message));

    sendOk(res, { stock, candles: compactCandles(candles), market: compactCandles(market), marketLabel: reference?.label ?? null, warning });
  } catch (err) {
    sendFailure(res, err, { log: '[Stocks] Candles GET error', message: 'Failed to load daily candles' });
  }
});

// Fill the setup scorecard from one stock's past year, so a newly added stock
// doesn't wait weeks for the nightly scan. Candles are brought up to date first.
app.post('/api/stocks/:token/setup-history', requireAuth, requireSubscription, async (req, res) => {
  try {
    const token = Number(req.params.token);
    const stock = Number.isInteger(token) ? await getCashStock(token) : null;
    if (!stock) return sendError(res, 400, 'Setup history covers NSE and BSE cash stocks only');

    try {
      await syncStockCandles(token, req.session.kiteSession);
    } catch (err) {
      console.warn(`[Stocks] Candle sync before setup history failed for ${stock.tradingsymbol}:`, err.message);
    }
    if (!(await getStockCandles(token)).length) {
      return sendError(res, 502, 'No daily candles stored for this stock and Kite could not supply them');
    }

    const counts = await backfillStockSetups(stock);
    console.log(`[Stocks] Setup history for ${stock.tradingsymbol}: ${counts.found} setup(s)`);
    sendOk(res, counts);
  } catch (err) {
    sendFailure(res, err, { log: '[Stocks] Setup history error', message: 'Failed to build the setup history' });
  }
});

// Latest scan summary for every stock in the user's watchlists (the Setups column).
app.get('/api/stocks/scans', requireAuth, requireSubscription, async (req, res) => {
  try {
    sendOk(res, await getStockScansForUser(req.session.kiteSession.userId));
  } catch (err) {
    sendFailure(res, err, { log: '[Stocks] Scans GET error', message: 'Failed to load stock scans' });
  }
});

// Setup scorecard for one stock: outcomes per setup type, plus its recent setups.
app.get('/api/stocks/:token/setups', requireAuth, requireSubscription, async (req, res) => {
  try {
    const token = Number(req.params.token);
    if (!Number.isInteger(token)) return sendError(res, 400, 'Invalid instrument token');
    const [stats, recent] = await Promise.all([getStockSetupStats(token), getStockSetupSignals(token, 30)]);
    sendOk(res, { stats, recent });
  } catch (err) {
    sendFailure(res, err, { log: '[Stocks] Setups GET error', message: 'Failed to load stock setups' });
  }
});

app.post('/api/oi-history/signals', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, signalDate, expiry, strike, optionType, action, status, entryPremium, spotPrice, details } = req.body || {};
    if (!scrip || !signalDate || !Number.isFinite(Number(strike)) || !isOptionType(optionType) || !isSide(action) || (status && !isTradeSetupStatus(status))) {
      return sendError(res, 400, 'Invalid trade setup signal');
    }
    const signal = await saveTradeSetupSignal(req.session.kiteSession.userId, {
      scrip, signalDate, expiry, strike: Number(strike), optionType, action,
      status: status || TradeSetupStatus.Watch, entryPremium: Number(entryPremium) || null,
      spotPrice: Number(spotPrice) || null, details,
    });
    sendCreated(res, signal);
  } catch (err) {
    console.error('[OI History] Signal save error:', err.message);
    sendError(res, 500, 'Failed to save trade setup signal');
  }
});

app.get('/api/oi-history/signals', requireAuth, requireSubscription, async (req, res) => {
  try {
    const signals = await getTradeSetupSignals(req.session.kiteSession.userId, {
      scrip: req.query.scrip || null,
      limit: req.query.limit,
    });
    sendOk(res, signals);
  } catch (err) {
    console.error('[OI History] Signal list error:', err.message);
    sendError(res, 500, 'Failed to load trade setup signals');
  }
});

app.delete('/api/oi-history/signals/:id', requireAuth, requireSubscription, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, 'Invalid signal id');
    }
    const deleted = await deleteTradeSetupSignal(req.session.kiteSession.userId, id);
    if (!deleted) return sendError(res, 404, 'Signal not found');
    sendOk(res);
  } catch (err) {
    console.error('[OI History] Signal delete error:', err.message);
    sendError(res, 500, 'Failed to delete signal');
  }
});

app.patch('/api/oi-history/signals/:id/outcome', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { price, date, returnPct, status, maxFavorableReturn, maxAdverseReturn, final } = req.body || {};
    if (!Number.isFinite(Number(price)) || !date || !Number.isFinite(Number(returnPct)) ||
        !Number.isFinite(Number(maxFavorableReturn)) || !Number.isFinite(Number(maxAdverseReturn)) ||
        !Object.values(SignalOutcome).includes(status)) {
      return sendError(res, 400, 'Invalid signal outcome');
    }
    const outcome = await updateTradeSetupSignalOutcome(req.session.kiteSession.userId, req.params.id, {
      price: Number(price), date, returnPct: Number(returnPct), status,
      maxFavorableReturn: Number(maxFavorableReturn), maxAdverseReturn: Number(maxAdverseReturn), final: Boolean(final),
    });
    if (!outcome) return sendError(res, 404, 'Signal not found');
    sendOk(res, outcome);
  } catch (err) {
    console.error('[OI History] Signal outcome error:', err.message);
    sendError(res, 500, 'Failed to save signal outcome');
  }
});

/**
 * DELETE /api/oi-history?scrip=NIFTY
 * Deletes all OI history rows for the given scrip. Admins only: the history is
 * shared by every user, not owned by the one asking.
 */
app.delete('/api/oi-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { scrip, month, expiryMonth } = req.query;

    if (scrip && !expiryMonth) {
      const deleted = await deleteOiHistoryByScrip(scrip);
      console.log(`[OI History] Deleted ${deleted} rows for ${scrip}`);
      return sendOk(res, { deleted });
    }

    if (expiryMonth) {
      if (!scrip) {
        return sendError(res, 400, 'scrip is required');
      }
      if (!/^\d{4}-\d{2}$/.test(expiryMonth)) {
        return sendError(res, 400, 'expiryMonth is required (format: YYYY-MM)');
      }
      const deleted = await deleteOiHistoryByExpiryMonth(scrip, expiryMonth);
      console.log(`[OI History] Deleted ${deleted} rows for ${scrip} expiry month ${expiryMonth}`);
      return sendOk(res, { deleted });
    }

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return sendError(res, 400, 'expiryMonth is required (format: YYYY-MM)');
    }

    const deleted = await deleteOiHistoryByMonth(month);
    console.log(`[OI History] Deleted ${deleted} rows for month ${month}`);
    sendOk(res, { deleted });
  } catch (err) {
    sendFailure(res, err, { log: '[OI History] DELETE error', message: 'Failed to delete OI history' });
  }
});

// ---------- F&O Symbols ----------

app.get('/api/fno-symbols', requireAuth, requireSubscription, async (req, res) => {
  try {
    const symbols = await getFnoSymbols();
    sendOk(res, symbols);
  } catch (err) {
    sendFailure(res, err, { log: '[F&O Symbols] Error', message: 'Failed to load F&O symbols' });
  }
});

/**
 * GET /api/underlyings
 * F&O underlyings with their price instrument and display settings:
 * [{ name, label, instrumentToken, exchange, tradingsymbol, tradingviewSymbol, alwaysSnapshot, isMarketReference, isIndex }]
 */
app.get('/api/underlyings', requireAuth, requireSubscription, async (req, res) => {
  try {
    sendOk(res, await getUnderlyings());
  } catch (err) {
    sendFailure(res, err, { log: '[Underlyings] Error', message: 'Failed to load underlyings' });
  }
});

/**
 * PATCH /api/admin/underlyings/:name  Body: { alwaysSnapshot: boolean }
 * Mark an underlying to be OI-snapshotted every trading day, or not.
 */
app.patch('/api/admin/underlyings/:name', requireAuth, requireAdmin, async (req, res) => {
  const { alwaysSnapshot } = req.body || {};
  if (typeof alwaysSnapshot !== 'boolean') {
    return sendError(res, 400, 'alwaysSnapshot must be true or false');
  }
  try {
    const underlying = await setAlwaysSnapshot(req.params.name, alwaysSnapshot);
    if (!underlying) return sendError(res, 404, `No price instrument for ${req.params.name}`);
    sendOk(res, underlying);
  } catch (err) {
    sendFailure(res, err, { log: '[Underlyings] Update error', message: 'Failed to update the underlying' });
  }
});

// ---------- Instruments (shared cache) ----------

app.get('/api/instruments', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { apiKey, accessToken } = req.session.kiteSession;
    const instruments = await getOrFetchInstruments(apiKey, accessToken);
    sendOk(res, instruments);
  } catch (err) {
    sendFailure(res, err, { log: '[Instruments] Error', message: 'Failed to load instruments from Kite', status: 502 });
  }
});

// ---------- API Proxy ----------

app.use('/api', requireAuth, requireSubscription, apiLimiter, allowOnlyKnownKiteCalls, createProxyMiddleware({
  target: KITE_API_URL,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  on: {
    proxyReq: (proxyReq, req) => {
      [
        'cookie',
        'cf-connecting-ip',
        'cf-ipcountry',
        'cf-ray',
        'cf-visitor',
        'cdn-loop',
        'forwarded',
        'origin',
        'referer',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-port',
        'x-forwarded-proto',
        'x-real-ip',
      ].forEach((header) => proxyReq.removeHeader(header));

      for (const [name, value] of Object.entries(kiteHeaders(req.session.kiteSession))) proxyReq.setHeader(name, value);
      proxyReq.setHeader('Accept', 'application/json');
    },
    proxyRes: (proxyRes, req) => {
      // Without the body yet, rule out replies that can't end the login.
      if (!isKiteAuthFailure(proxyRes.statusCode)) return;
      // Clear an expired Kite login but keep the session itself intact so the
      // remember cookie + pending credentials still work. A 403 for a call this
      // Kite app isn't allowed (PermissionException) leaves the login alone.
      readKiteBody(proxyRes).then((body) => {
        if (!isKiteAuthFailure(proxyRes.statusCode, body)) return;
        delete req.session.kiteSession;
        req.session.save(() => {});
      });
    },
  },
}));

// ---------- WebSocket Proxy ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
const wsConnections = createConcurrencyLimit(MAX_CONNECTIONS_PER_USER);
/** Close code telling the browser its Kite session has expired (mirrored in src/services/kiteTicker.ts). */
const WS_SESSION_EXPIRED = 4001;

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  if (!isSameSiteWsOrigin(request.headers)) {
    console.log(`${ts()} ${RED}WS${RESET} refused origin ${request.headers.origin} for host ${request.headers.host}`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const sid = signedSessionId(request.headers.cookie, 'optiontrap_sid', SESSION_SECRET);
  if (!sid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  sessionStore.get(sid, (err, sessionData) => {
    if (err || !sessionData?.kiteSession?.apiKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Same rule as requireSubscription (admins pass without a subscription).
    checkSubscriptionAccess(sessionData.kiteSession.userId, accessDeps)
      .then((access) => {
        if (!access.allowed) {
          socket.write('HTTP/1.1 402 Payment Required\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          ws._kiteSession = sessionData.kiteSession;
          ws._sid = sid;
          wss.emit('connection', ws, request);
        });
      })
      .catch((err) => {
        console.error(`${ts()} ${RED}WS${RESET} subscription check failed:`, err);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      });
  });
});

wss.on('connection', (clientWs) => {
  const { apiKey, accessToken, userId } = clientWs._kiteSession;

  if (!apiKey || !accessToken) {
    console.log(`${ts()} ${RED}WS${RESET} rejected — missing credentials`);
    clientWs.close(4003, 'Missing credentials');
    return;
  }

  if (!wsConnections.tryAcquire(userId)) {
    console.log(`${ts()} ${RED}WS${RESET} rejected — already ${MAX_CONNECTIONS_PER_USER} connections ${GREY}[${userId}]${RESET}`);
    clientWs.close(1008, 'Too many connections');
    return;
  }
  clientWs.once('close', () => wsConnections.release(userId));

  console.log(`${ts()} ${GREEN}WS${RESET} connected ${GREY}[${userId}]${RESET}`);

  const kiteWs = new WebSocket(kiteTickerUrl({ apiKey, accessToken }));
  kiteWs.binaryType = 'arraybuffer';

  // Stop reading from the browser until Kite is connected, so its messages wait in
  // the socket (TCP backpressure) instead of piling up in memory. Only what arrived
  // with the upgrade itself can reach this buffer, so it stays small.
  clientWs.pause();
  const pendingMessages = [];
  let kiteReady = false;

  kiteWs.on('open', () => {
    console.log(`${ts()} ${GREEN}WS${RESET} upstream Kite connected ${GREY}[${userId}]${RESET}`);
    kiteReady = true;
    for (const { data, isBinary } of pendingMessages) {
      kiteWs.send(data, { binary: isBinary });
    }
    pendingMessages.length = 0;
    clientWs.resume();
  });

  // Kite answers an expired or revoked access token with 403 on the handshake.
  // Clear the Kite session like the REST proxy does, and tell the client with
  // WS_SESSION_EXPIRED so it sends the user to login instead of reconnecting.
  kiteWs.on('unexpected-response', (_req, res) => {
    res.resume();
    console.log(`${ts()} ${RED}WS${RESET} upstream rejected: HTTP ${res.statusCode} ${GREY}[${userId}]${RESET}`);
    if (isKiteAuthFailure(res.statusCode)) {
      sessionStore.get(clientWs._sid, (err, sessionData) => {
        if (err || !sessionData?.kiteSession) return;
        delete sessionData.kiteSession;
        sessionStore.set(clientWs._sid, sessionData, () => {});
      });
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(WS_SESSION_EXPIRED, 'Kite session expired');
    } else if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Upstream error');
    }
    kiteWs.terminate();
  });

  kiteWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('message', (data, isBinary) => {
    if (kiteReady && kiteWs.readyState === WebSocket.OPEN) {
      kiteWs.send(data, { binary: isBinary });
    } else {
      pendingMessages.push({ data, isBinary });
    }
  });

  kiteWs.on('close', () => {
    console.log(`${ts()} ${YELLOW}WS${RESET} upstream disconnected ${GREY}[${userId}]${RESET}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Kite disconnected');
    }
    // Read again (if Kite never connected) so the browser's close reply ends the connection now.
    clientWs.resume();
  });

  kiteWs.on('error', (err) => {
    console.log(`${ts()} ${RED}WS${RESET} upstream error: ${err.message} ${GREY}[${userId}]${RESET}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Upstream error');
    }
  });

  clientWs.on('close', () => {
    console.log(`${ts()} ${YELLOW}WS${RESET} client disconnected ${GREY}[${userId}]${RESET}`);
    if (kiteWs.readyState === WebSocket.OPEN) {
      kiteWs.close();
    }
  });

  clientWs.on('error', () => {
    if (kiteWs.readyState === WebSocket.OPEN) {
      kiteWs.close();
    }
  });
});

// ---------- Static Files (Production) ----------

if (IS_PROD) {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/auth') && !req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

app.use(sendServerError);

// ---------- Start ----------

async function start() {
  // Initialise PostgreSQL
  await initDb();

  // The scheduled jobs (server/scheduledJobs.js): OI snapshots, OI history, the stock scan,
  // the instrument sync, the nightly jobs and signal outcomes, each on the market clock.
  scheduledJobs.start();
  // The trade engine: fills and cancels orders, runs the strategies and turns their signals
  // into automated paper trades, and exits automated positions when their exit rules fire.
  tradeEngine.start();

  server.listen(PORT, () => {
    console.log(`${ts()} ${GREEN}Server${RESET} OptionTrap running on port ${PORT}`);
    console.log(`${ts()} ${GREEN}Server${RESET} Mode: ${IS_PROD ? 'production' : 'development'}`);
    console.log(`${ts()} ${GREEN}Server${RESET} Credentials: client-side only (localStorage)`);
  });
}

// Graceful shutdown
async function shutdown() {
  authLimiter.close();
  apiLimiter.close();
  generalLimiter.close();
  sessionStore.close();
  await closeDb();
}

process.on('SIGINT', async () => {
  console.log(`\n${ts()} ${YELLOW}Server${RESET} shutting down...`);
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
