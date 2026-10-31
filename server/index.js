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

// Disable TLS cert verification for outbound requests to Kite API.
// Required on Windows where Node.js doesn't use the system certificate store.
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import { createProxyMiddleware } from 'http-proxy-middleware';
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
  createWatchlist,
  getWatchlists,
  getWatchlistItems,
  renameWatchlist,
  deleteWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  getPositions,
  addPosition,
  exitPositionById,
  removePositionById,
  clearPositions,
  saveOiSnapshot,
  getTodayOiSnapshots,
  getLatestOiSnapshotTimestamp,
  getOiHistoryData,
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
  deleteOiHistoryByScrip,
  getNseStock,
  getStockCandles,
  getStockScansForUser,
  getStockSetupStats,
  getStockSetupSignalsForUser,
} from './db.js';
import { PostgresSessionStore } from './sessionStore.js';
import { createRateLimiter } from './rateLimit.js';
import { cached } from './cache.js';
import { getOrFetchInstruments } from './instruments.js';
import { fetchOiHistoryMonth, OiHistoryFetchError, todayIST } from './oiHistoryFetch.js';
import { OI_HISTORY_JOB, startOiHistoryScheduler } from './oiHistoryScheduler.js';
import { checkSubscriptionAccess, inactiveSubscription } from './subscriptionAccess.js';
import { backfillStockSetups, scanStock, syncStockCandles } from './stockCandles.js';
import { startStockSetupScheduler } from './stockSetupScheduler.js';
import { NIGHTLY_JOB_PREFIX, startNightlyJobs } from './nightlyJobs.js';
import { NIFTY_50_TOKEN } from '../shared/stockSetups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';
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
  keyFn: (req) => req.session?.kiteSession?.userId || req.ip || 'unknown',
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
      .then((safe) => res.json({
        status: 'ok',
        authenticated: true,
        data: safe,
      }))
      .catch((err) => {
        console.error(`${ts()} ${RED}AUTH${RESET} status error:`, err);
        res.status(500).json({ status: 'error', message: 'Failed to load auth status' });
      });
  } else {
    res.json({
      status: 'ok',
      authenticated: false,
      data: null,
    });
  }
});

// Get Kite OAuth login URL — apiKey comes from client (stored in localStorage)
app.get('/auth/login-url', (req, res) => {
  const apiKey = req.query.api_key;

  if (!apiKey) {
    return res.status(400).json({
      status: 'error',
      message: 'api_key query parameter is required',
    });
  }

  const url = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`;
  res.json({ url });
});

// Check session (backward compat with useKiteSession)
app.get('/auth/me', (req, res) => {
  if (req.session?.kiteSession) {
    getSafeSession(req.session.kiteSession)
      .then((safe) => res.json({ status: 'ok', data: safe }))
      .catch((err) => {
        console.error(`${ts()} ${RED}AUTH${RESET} me error:`, err);
        res.status(500).json({ status: 'error', message: 'Failed to load session' });
      });
  } else {
    res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }
});

// Exchange request_token for access_token
// Credentials come from client body (stored in browser localStorage)
app.post('/auth/token', async (req, res) => {
  const { request_token, apiKey, apiSecret } = req.body;

  if (!request_token || !apiKey || !apiSecret) {
    return res.status(400).json({
      status: 'error',
      message: 'request_token, apiKey, and apiSecret are required',
    });
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

    const response = await fetch('https://api.kite.trade/session/token', {
      method: 'POST',
      headers: {
        'X-Kite-Version': '3',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ api_key: apiKey, request_token, checksum }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${ts()} ${RED}AUTH${RESET} exchange failed: ${response.status} ${errorText}`);
      let message = `Kite token exchange failed (${response.status})`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.message) message = parsed.message;
      } catch { /* use default message */ }
      return res.status(response.status).json({ status: 'error', message });
    }

    const result = await response.json();
    const data = result.data;

    // 1. Record user identity (no credentials stored)
    await upsertUser(data.user_id, data.user_name);

    // 2. Resolve role (admins bypass subscription and unlock the admin inbox)
    const isAdmin = await isUserAdmin(data.user_id);

    // 3. Set active session
    req.session.kiteSession = {
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

    const safe = await getSafeSession(req.session.kiteSession);
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`${ts()} ${GREEN}AUTH${RESET} logged in: ${data.user_id} (${data.user_name})`);
    res.json({ status: 'ok', data: safe });
  } catch (err) {
    console.error(`${ts()} ${RED}AUTH${RESET} exchange error:`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message: `Token exchange error: ${errMsg}` });
  }
});

// Logout — destroy session (credentials remain in browser localStorage)
app.post('/auth/logout', async (req, res) => {
  const kiteSession = req.session?.kiteSession;

  if (kiteSession?.apiKey && kiteSession?.accessToken) {
    try {
      await fetch('https://api.kite.trade/session/token', {
        method: 'DELETE',
        headers: {
          'X-Kite-Version': '3',
          'Authorization': `token ${kiteSession.apiKey}:${kiteSession.accessToken}`,
        },
      });
    } catch {
      // Ignore Kite-side errors on logout
    }
  }

  req.session.destroy(() => {
    res.clearCookie('optiontrap_sid');
    res.json({ status: 'ok' });
  });
});

// Delete account — remove user, destroy session
app.delete('/auth/account', async (req, res) => {
  const kiteSession = req.session?.kiteSession;
  const userId = kiteSession?.userId;

  if (!userId) {
    return res.status(400).json({ status: 'error', message: 'No account found to delete' });
  }

  // Invalidate Kite token if we have one
  if (kiteSession?.accessToken) {
    fetch('https://api.kite.trade/session/token', {
      method: 'DELETE',
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${kiteSession.apiKey}:${kiteSession.accessToken}`,
      },
    }).catch(() => {});
  }

  // Delete user
  await deleteUser(userId);

  // Destroy session
  req.session.destroy(() => {
    res.clearCookie('optiontrap_sid');
    console.log(`${ts()} ${RED}AUTH${RESET} account deleted: ${userId}`);
    res.json({ status: 'ok' });
  });
});

// ---------- Auth guard ----------

const requireAuth = (req, res, next) => {
  if (!req.session?.kiteSession?.apiKey) {
    return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  const userId = req.session?.kiteSession?.userId;

  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }

  try {
    // Authoritative check against the DB (live), not the cached session flag —
    // so role changes take effect without requiring the user to log in again.
    if (!(await isUserAdmin(userId))) {
      return res.status(403).json({ status: 'error', message: 'Admin access required' });
    }
    next();
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} guard error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to verify admin access' });
  }
};

const requireSubscription = async (req, res, next) => {
  try {
    const access = await checkSubscriptionAccess(req.session?.kiteSession?.userId, accessDeps);

    if (access.allowed) {
      req.subscription = access.subscription;
      return next();
    }

    if (access.reason === 'unauthenticated') {
      return res.status(401).json({ status: 'error', message: 'Not authenticated' });
    }

    return res.status(402).json({
      status: 'error',
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'An active subscription is required',
      data: access.subscription,
    });
  } catch (err) {
    console.error(`${ts()} ${RED}SUBSCRIPTION${RESET} gate error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to verify subscription' });
  }
};

// Public: active plans for the pre-login landing page (no auth, no secrets).
// Cached in memory for 30 minutes — plans change rarely, and this shields the
// DB from unauthenticated traffic floods (single-flight prevents stampedes).
const getCachedPlans = cached(getActiveSubscriptionPlans, 30 * 60_000);

app.get('/api/version', (_req, res) => {
  res.json({ status: 'ok', data: { version: APP_VERSION } });
});

app.get('/api/public/plans', async (_req, res) => {
  try {
    const plans = await getCachedPlans();
    res.json({ status: 'ok', data: plans });
  } catch (err) {
    console.error(`${ts()} ${RED}PLANS${RESET} public plans error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to load plans' });
  }
});

app.get('/api/subscription/plans', requireAuth, async (_req, res) => {
  const plans = await getActiveSubscriptionPlans();
  res.json({ status: 'ok', data: plans });
});

app.get('/api/subscription/status', requireAuth, async (req, res) => {
  const subscription = await getSubscriptionSummary(req.session.kiteSession.userId);
  res.json({ status: 'ok', data: subscription });
});

app.post('/api/subscription/activate', requireAuth, async (req, res) => {
  const { planId = 'one_month' } = req.body || {};

  try {
    const subscription = await activateSubscription(req.session.kiteSession.userId, planId, 'internal');
    res.json({ status: 'ok', data: subscription });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message || 'Failed to activate subscription' });
  }
});

app.post('/api/feedback', requireAuth, async (req, res) => {
  const { type, message, pageUrl, userAgent } = req.body || {};
  const allowedTypes = new Set(['bug', 'feature', 'general', 'subscription']);

  if (!allowedTypes.has(type)) {
    return res.status(400).json({ status: 'error', message: 'Valid feedback type is required' });
  }

  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return res.status(400).json({ status: 'error', message: 'Feedback message must be at least 5 characters' });
  }

  const feedback = await createFeedback({
    userId: req.session.kiteSession.userId,
    type,
    message: message.trim().slice(0, 4000),
    pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 1000) : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 1000) : req.get('user-agent'),
  });

  res.json({ status: 'ok', data: feedback });
});

// ---------- Admin Routes ----------
// Auth + admin role required. No subscription needed — admins have full access.

// Recent runs of the after-close OI history fetch, newest first.
app.get('/api/admin/scheduled-jobs/oi-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ status: 'ok', data: await getScheduledJobRuns(OI_HISTORY_JOB, 14) });
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} scheduled job runs error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to load scheduled job runs' });
  }
});

// Recent runs of the nightly jobs (server/jobs/nightly/), newest first.
app.get('/api/admin/scheduled-jobs/nightly', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ status: 'ok', data: await getScheduledJobRunsByPrefix(NIGHTLY_JOB_PREFIX, 100) });
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} nightly job runs error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to load nightly job runs' });
  }
});

const FEEDBACK_STATUSES = new Set(['open', 'reviewed', 'resolved']);
const FEEDBACK_TYPES = new Set(['bug', 'feature', 'general', 'subscription']);

app.get('/api/admin/feedback', requireAuth, requireAdmin, async (req, res) => {
  const { type, status } = req.query;

  if (type && !FEEDBACK_TYPES.has(type)) {
    return res.status(400).json({ status: 'error', message: 'Invalid feedback type filter' });
  }

  if (status && !FEEDBACK_STATUSES.has(status)) {
    return res.status(400).json({ status: 'error', message: 'Invalid feedback status filter' });
  }

  try {
    const feedback = await getFeedbackList({ type: type || null, status: status || null });
    res.json({ status: 'ok', data: feedback });
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} feedback list error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to load feedback' });
  }
});

app.patch('/api/admin/feedback/:id', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};

  if (!FEEDBACK_STATUSES.has(status)) {
    return res.status(400).json({
      status: 'error',
      message: 'status must be one of: open, reviewed, resolved',
    });
  }

  try {
    const updated = await updateFeedbackStatus(req.params.id, status);

    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Feedback not found' });
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} feedback update error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to update feedback' });
  }
});

app.get('/api/admin/health', requireAuth, requireAdmin, async (req, res) => {
  const dbConnected = await pingDb();

  // Gather metrics independently so a single failure doesn't blank the page.
  const [usage, feedback, lastOi] = await Promise.allSettled([
    getUsageStats(),
    getFeedbackCounts(),
    getLatestOiSnapshotTimestamp(),
  ]);

  const val = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
  const kite = req.session?.kiteSession;

  res.json({
    status: 'ok',
    data: {
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
      server: {
        uptimeSeconds: Math.round(process.uptime()),
        mode: IS_PROD ? 'production' : 'development',
      },
      timestamp: Date.now(),
    },
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await getAdminUsers();
    res.json({ status: 'ok', data: users });
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} users list error:`, err);
    res.status(500).json({ status: 'error', message: 'Failed to load users' });
  }
});

app.post('/api/admin/users/:userId/subscription', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { action, planId } = req.body || {};

  try {
    let subscription;
    if (action === 'activate') {
      if (!planId) return res.status(400).json({ status: 'error', message: 'planId is required' });
      subscription = await adminActivateSubscription(userId, planId);
    } else if (action === 'extend') {
      if (!planId) return res.status(400).json({ status: 'error', message: 'planId is required' });
      subscription = await adminExtendSubscription(userId, planId);
    } else if (action === 'cancel') {
      subscription = await adminCancelSubscription(userId);
    } else {
      return res.status(400).json({ status: 'error', message: 'action must be activate, extend or cancel' });
    }

    res.json({ status: 'ok', data: subscription });
  } catch (err) {
    console.error(`${ts()} ${RED}ADMIN${RESET} subscription update error:`, err);
    res.status(400).json({ status: 'error', message: err.message || 'Failed to update subscription' });
  }
});

// ---------- Watchlist Routes ----------

app.get('/api/watchlist', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const lists = await getWatchlists(userId);
  res.json({ status: 'ok', data: lists });
});

app.get('/api/watchlist/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const list = await getWatchlistItems(req.params.id, userId);

  if (!list) {
    return res.status(404).json({ status: 'error', message: 'Watchlist not found' });
  }

  res.json({ status: 'ok', data: list });
});

app.post('/api/watchlist', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Watchlist name is required' });
  }

  const list = await createWatchlist(userId, name);
  res.json({ status: 'ok', data: list });
});

app.put('/api/watchlist/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Name is required' });
  }

  const updated = await renameWatchlist(req.params.id, userId, name);
  if (!updated) {
    return res.status(404).json({ status: 'error', message: 'Watchlist not found' });
  }

  res.json({ status: 'ok' });
});

app.delete('/api/watchlist/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const deleted = await deleteWatchlist(req.params.id, userId);

  if (!deleted) {
    return res.status(404).json({ status: 'error', message: 'Watchlist not found' });
  }

  res.json({ status: 'ok' });
});

app.post('/api/watchlist/:id/items', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { instrumentToken, tradingsymbol, exchange } = req.body;

  if (!instrumentToken || !tradingsymbol) {
    return res.status(400).json({
      status: 'error',
      message: 'instrumentToken and tradingsymbol are required',
    });
  }

  const item = await addWatchlistItem(req.params.id, userId, {
    instrumentToken: Number(instrumentToken),
    tradingsymbol,
    exchange: exchange || 'NSE',
  });

  if (!item) {
    return res.status(400).json({
      status: 'error',
      message: 'Limit reached (100), duplicate instrument, or watchlist not found',
    });
  }

  res.json({ status: 'ok', data: item });
});

app.delete('/api/watchlist/:id/items/:itemId', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const removed = await removeWatchlistItem(req.params.itemId, userId);

  if (!removed) {
    return res.status(404).json({ status: 'error', message: 'Item not found' });
  }

  res.json({ status: 'ok' });
});

// ---------- Positions ----------

app.get('/api/positions', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const mode = req.query.mode || null;
  const positions = await getPositions(userId, mode);
  res.json({ status: 'ok', data: positions });
});

app.post('/api/positions', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const {
    tradingsymbol,
    instrumentToken,
    strike,
    optionType,
    side,
    quantity,
    entryPrice,
    expiry,
    mode,
    note,
    targetPrice,
    stopLossPrice,
    strategyTag,
    confidence,
  } = req.body;

  if (!tradingsymbol || !instrumentToken || strike == null || !optionType || !side || !quantity || !entryPrice || !expiry) {
    return res.status(400).json({ status: 'error', message: 'Missing required fields' });
  }

  const position = await addPosition(userId, {
    tradingsymbol,
    instrumentToken: Number(instrumentToken),
    strike: Number(strike),
    optionType,
    side,
    quantity: Number(quantity),
    entryPrice: Number(entryPrice),
    expiry,
    mode: mode || 'paper',
    note,
    targetPrice,
    stopLossPrice,
    strategyTag,
    confidence,
  });

  res.json({ status: 'ok', data: position });
});

app.put('/api/positions/:id/exit', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { exitPrice } = req.body;

  if (exitPrice == null) {
    return res.status(400).json({ status: 'error', message: 'exitPrice is required' });
  }

  const updated = await exitPositionById(req.params.id, userId, Number(exitPrice));
  if (!updated) {
    return res.status(404).json({ status: 'error', message: 'Position not found or already exited' });
  }

  res.json({ status: 'ok' });
});

app.delete('/api/positions/:id', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const removed = await removePositionById(req.params.id, userId);

  if (!removed) {
    return res.status(404).json({ status: 'error', message: 'Position not found' });
  }

  res.json({ status: 'ok' });
});

app.delete('/api/positions', requireAuth, requireSubscription, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const mode = req.query.mode || null;
  await clearPositions(userId, mode);
  res.json({ status: 'ok' });
});

// ---------- OI Snapshots (shared) ----------

app.get('/api/oi-snapshots', requireAuth, requireSubscription, async (req, res) => {
  try {
    const snapshots = await getTodayOiSnapshots();
    res.json({ status: 'ok', data: snapshots });
  } catch (err) {
    console.error('[OI Snapshots] GET error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/oi-snapshots/latest', requireAuth, requireSubscription, async (req, res) => {
  try {
    const timestamp = await getLatestOiSnapshotTimestamp();
    res.json({ status: 'ok', data: { timestamp } });
  } catch (err) {
    console.error('[OI Snapshots] GET latest error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/oi-snapshots', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { timestamp, timeLabel, data, prices, close, spot, volumes } = req.body;
    if (!timestamp || !timeLabel || !data) {
      return res.status(400).json({ status: 'error', message: 'Missing required fields: timestamp, timeLabel, data' });
    }
    await saveOiSnapshot({ timestamp, timeLabel, data, prices, close, spot, volumes });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[OI Snapshots] POST error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------- OI History (historical daily OI) ----------

/**
 * POST /api/oi-history/fetch — Fetch historical daily OI candles from Kite.
 * Fetches missing dates from the current month and always refreshes today.
 * Streams progress via Server-Sent Events (SSE).
 * Body: { scrip: 'NIFTY50', expiryMonth: 'YYYY-MM' }
 *
 * SSE events:
 *   step     — { step, message }
 *   progress — { done, total, pct, batch, totalBatches, symbol }
 *   done     — { rowCount, tradingDays, skippedDays, fetchedDays, uniqueTokens }
 *   error    — { message }
 */
app.post('/api/oi-history/fetch', requireAuth, requireSubscription, async (req, res) => {
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
    const { scrip, expiryMonth, strikeMode = 'atmRange', specificStrike } = req.body;
    const { apiKey, accessToken } = req.session.kiteSession;
    const summary = await fetchOiHistoryMonth({
      scrip, expiryMonth, strikeMode, specificStrike, apiKey, accessToken, send, signal: cancel.signal,
    });

    // New prices may settle open signals; score them before the client reloads.
    try {
      await evaluateTradeSetupSignalOutcomes(scrip);
    } catch (err) {
      console.warn('[OI History] Signal outcome evaluation failed:', err.message);
    }

    send('done', summary);
    res.end();
  } catch (err) {
    if (cancel.signal.aborted) {
      console.log(`[OI History] Fetch cancelled by client for ${req.body?.scrip} ${req.body?.expiryMonth}`);
      return;
    }
    if (err instanceof OiHistoryFetchError) {
      send('error', { message: err.message });
      return res.end();
    }
    console.error('[OI History] Fetch error:', err.message);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * GET /api/oi-history/expiry-months?scrip=NIFTY50
 * Returns list of future expiry months available in current instruments.
 */
app.get('/api/oi-history/expiry-months', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip } = req.query;
    if (!scrip) {
      return res.status(400).json({ status: 'error', message: 'scrip is required' });
    }

    const { apiKey, accessToken } = req.session.kiteSession;
    const instruments = await getOrFetchInstruments(apiKey, accessToken);
    const scripName = scrip === 'NIFTY50' ? 'NIFTY' : scrip;
    const minExpiryDate = todayIST();
    const liveMonths = [...new Set(
      instruments
        .filter((inst) =>
          inst.name === scripName &&
          inst.exchange === 'NFO' &&
          (inst.instrumentType === 'CE' || inst.instrumentType === 'PE') &&
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
    res.json({ status: 'ok', months });
  } catch (err) {
    console.error('[OI History] Expiry months error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/oi-history?scrip=NIFTY50&expiryMonth=YYYY-MM
 * Returns stored OI history data for the selected expiry month.
 */
app.get('/api/oi-history', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, from, to, expiryMonth } = req.query;
    if (!scrip) {
      return res.status(400).json({ status: 'error', message: 'scrip is required' });
    }
    if (expiryMonth) {
      const data = await getOiHistoryDataByExpiryMonth(scrip, expiryMonth, from || null);
      return res.json({ status: 'ok', data });
    }
    const data = await getOiHistoryData(scrip, from, to);
    res.json({ status: 'ok', data });
  } catch (err) {
    console.error('[OI History] GET error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/oi-history/futures', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, expiryMonth, from } = req.query;
    if (!scrip || !expiryMonth) return res.status(400).json({ status: 'error', message: 'scrip and expiryMonth are required' });
    const data = await getOiHistoryFuturesData(scrip, expiryMonth, from || null);
    res.json({ status: 'ok', data });
  } catch (err) {
    console.error('[OI History] Futures GET error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------- Watchlist stock setups ----------

/** Candles as compact [date, open, high, low, close, volume] rows: about half the JSON of objects. */
const compactCandles = (candles) => candles.map((c) => [c.date, c.open, c.high, c.low, c.close, c.volume]);

// One stock's stored daily candles plus NIFTY 50's, brought up to date with the
// user's own Kite session first. If Kite fails but candles are stored, they are
// returned with a warning rather than an error.
app.get('/api/stocks/:token/candles', requireAuth, requireSubscription, async (req, res) => {
  try {
    const token = Number(req.params.token);
    const stock = Number.isInteger(token) ? await getNseStock(token) : null;
    if (!stock) return res.status(400).json({ status: 'error', message: 'Entry and exit zones cover NSE cash stocks only' });

    const kite = req.session.kiteSession;
    let warning = null;
    let synced = false;
    try {
      await syncStockCandles(NIFTY_50_TOKEN, kite);
      const sync = await syncStockCandles(token, kite);
      synced = !sync.skipped;
    } catch (err) {
      console.warn(`[Stocks] Candle sync failed for ${stock.tradingsymbol}:`, err.message);
      warning = err.message;
    }

    const [candles, market] = await Promise.all([getStockCandles(token), getStockCandles(NIFTY_50_TOKEN)]);
    if (!candles.length) {
      return res.status(502).json({ status: 'error', message: warning || 'Kite returned no daily candles for this stock' });
    }
    // Keep the watchlist's Setups column in step with what the panel shows.
    if (synced) await scanStock(stock, market).catch((err) => console.warn(`[Stocks] Scan failed for ${stock.tradingsymbol}:`, err.message));

    res.json({ status: 'ok', data: { stock, candles: compactCandles(candles), market: compactCandles(market), warning } });
  } catch (err) {
    console.error('[Stocks] Candles GET error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Fill the setup scorecard from one stock's past year, so a newly added stock
// doesn't wait weeks for the nightly scan. Candles are brought up to date first.
app.post('/api/stocks/:token/setup-history', requireAuth, requireSubscription, async (req, res) => {
  try {
    const token = Number(req.params.token);
    const stock = Number.isInteger(token) ? await getNseStock(token) : null;
    if (!stock) return res.status(400).json({ status: 'error', message: 'Setup history covers NSE cash stocks only' });

    try {
      await syncStockCandles(token, req.session.kiteSession);
    } catch (err) {
      console.warn(`[Stocks] Candle sync before setup history failed for ${stock.tradingsymbol}:`, err.message);
    }
    if (!(await getStockCandles(token)).length) {
      return res.status(502).json({ status: 'error', message: 'No daily candles stored for this stock and Kite could not supply them' });
    }

    const counts = await backfillStockSetups(stock);
    console.log(`[Stocks] Setup history for ${stock.tradingsymbol}: ${counts.found} setup(s)`);
    res.json({ status: 'ok', data: counts });
  } catch (err) {
    console.error('[Stocks] Setup history error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Latest scan summary for every stock in the user's watchlists (the Setups column).
app.get('/api/stocks/scans', requireAuth, requireSubscription, async (req, res) => {
  try {
    res.json({ status: 'ok', data: await getStockScansForUser(req.session.kiteSession.userId) });
  } catch (err) {
    console.error('[Stocks] Scans GET error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Setup scorecard: outcomes per setup type across all tracked stocks, plus recent
// setups on the user's own watchlist stocks.
app.get('/api/stocks/setups', requireAuth, requireSubscription, async (req, res) => {
  try {
    const [stats, recent] = await Promise.all([getStockSetupStats(), getStockSetupSignalsForUser(req.session.kiteSession.userId, 30)]);
    res.json({ status: 'ok', data: { stats, recent } });
  } catch (err) {
    console.error('[Stocks] Setups GET error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/oi-history/signals', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, signalDate, expiry, strike, optionType, action, status, entryPremium, spotPrice, details } = req.body || {};
    if (!scrip || !signalDate || !Number.isFinite(Number(strike)) || !['CE', 'PE'].includes(optionType) || !['BUY', 'SELL'].includes(action)) {
      return res.status(400).json({ status: 'error', message: 'Invalid trade setup signal' });
    }
    const signal = await saveTradeSetupSignal(req.session.kiteSession.userId, {
      scrip, signalDate, expiry, strike: Number(strike), optionType, action,
      status: status || 'Watch', entryPremium: Number(entryPremium) || null,
      spotPrice: Number(spotPrice) || null, details,
    });
    res.json({ status: 'ok', signal });
  } catch (err) {
    console.error('[OI History] Signal save error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to save trade setup signal' });
  }
});

app.get('/api/oi-history/signals', requireAuth, requireSubscription, async (req, res) => {
  try {
    const signals = await getTradeSetupSignals(req.session.kiteSession.userId, {
      scrip: req.query.scrip || null,
      limit: req.query.limit,
    });
    res.json({ status: 'ok', signals });
  } catch (err) {
    console.error('[OI History] Signal list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to load trade setup signals' });
  }
});

app.delete('/api/oi-history/signals/:id', requireAuth, requireSubscription, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid signal id' });
    }
    const deleted = await deleteTradeSetupSignal(req.session.kiteSession.userId, id);
    if (!deleted) return res.status(404).json({ status: 'error', message: 'Signal not found' });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[OI History] Signal delete error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to delete signal' });
  }
});

app.patch('/api/oi-history/signals/:id/outcome', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { price, date, returnPct, status, maxFavorableReturn, maxAdverseReturn, final } = req.body || {};
    if (!Number.isFinite(Number(price)) || !date || !Number.isFinite(Number(returnPct)) ||
        !Number.isFinite(Number(maxFavorableReturn)) || !Number.isFinite(Number(maxAdverseReturn)) ||
        !['Profit', 'Loss', 'Open'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Invalid signal outcome' });
    }
    const outcome = await updateTradeSetupSignalOutcome(req.session.kiteSession.userId, req.params.id, {
      price: Number(price), date, returnPct: Number(returnPct), status,
      maxFavorableReturn: Number(maxFavorableReturn), maxAdverseReturn: Number(maxAdverseReturn), final: Boolean(final),
    });
    if (!outcome) return res.status(404).json({ status: 'error', message: 'Signal not found' });
    res.json({ status: 'ok', outcome });
  } catch (err) {
    console.error('[OI History] Signal outcome error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to save signal outcome' });
  }
});

/**
 * DELETE /api/oi-history?scrip=NIFTY50
 * Deletes all OI history rows for the given scrip.
 */
app.delete('/api/oi-history', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { scrip, month, expiryMonth } = req.query;

    if (scrip && !expiryMonth) {
      const deleted = await deleteOiHistoryByScrip(scrip);
      console.log(`[OI History] Deleted ${deleted} rows for ${scrip}`);
      return res.json({ status: 'ok', deleted });
    }

    if (expiryMonth) {
      if (!scrip) {
        return res.status(400).json({ status: 'error', message: 'scrip is required' });
      }
      if (!/^\d{4}-\d{2}$/.test(expiryMonth)) {
        return res.status(400).json({ status: 'error', message: 'expiryMonth is required (format: YYYY-MM)' });
      }
      const deleted = await deleteOiHistoryByExpiryMonth(scrip, expiryMonth);
      console.log(`[OI History] Deleted ${deleted} rows for ${scrip} expiry month ${expiryMonth}`);
      return res.json({ status: 'ok', deleted });
    }

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ status: 'error', message: 'expiryMonth is required (format: YYYY-MM)' });
    }

    const deleted = await deleteOiHistoryByMonth(month);
    console.log(`[OI History] Deleted ${deleted} rows for month ${month}`);
    res.json({ status: 'ok', deleted });
  } catch (err) {
    console.error('[OI History] DELETE error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------- F&O Symbols ----------

app.get('/api/fno-symbols', requireAuth, requireSubscription, async (req, res) => {
  try {
    const symbols = await getFnoSymbols();
    res.json({ status: 'ok', data: symbols });
  } catch (err) {
    console.error('[F&O Symbols] Error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------- Instruments (shared cache) ----------

app.get('/instruments', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { apiKey, accessToken } = req.session.kiteSession;
    const instruments = await getOrFetchInstruments(apiKey, accessToken);
    res.json({ status: 'ok', data: instruments });
  } catch (err) {
    console.error('[Instruments] Error:', err.message);
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// ---------- API Proxy ----------

app.use('/api', requireAuth, requireSubscription, apiLimiter, createProxyMiddleware({
  target: 'https://api.kite.trade',
  changeOrigin: true,
  secure: false,
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

      const { apiKey, accessToken } = req.session.kiteSession;
      proxyReq.setHeader('Authorization', `token ${apiKey}:${accessToken}`);
      proxyReq.setHeader('X-Kite-Version', '3');
      proxyReq.setHeader('Accept', 'application/json');
    },
    proxyRes: (proxyRes, req) => {
      if (proxyRes.statusCode === 403) {
        // Clear expired Kite session but keep the session itself intact
        // so the remember cookie + pending credentials still work
        delete req.session.kiteSession;
        req.session.save(() => {});
      }
    },
  },
}));

// ---------- WebSocket Proxy ----------

const wss = new WebSocketServer({ noServer: true });
/** Close code telling the browser its Kite session has expired (mirrored in src/services/kiteTicker.ts). */
const WS_SESSION_EXPIRED = 4001;

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  // Parse cookies from upgrade request
  const cookies = {};
  (request.headers.cookie || '').split(';').forEach((c) => {
    const [name, ...rest] = c.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });

  const rawSid = cookies['optiontrap_sid'];
  if (!rawSid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const sid = cookieParser.signedCookie(decodeURIComponent(rawSid), SESSION_SECRET);
  if (!sid || sid === rawSid) {
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

  console.log(`${ts()} ${GREEN}WS${RESET} connected ${GREY}[${userId}]${RESET}`);

  const kiteWsUrl = `wss://ws.kite.trade?api_key=${apiKey}&access_token=${accessToken}`;
  const kiteWs = new WebSocket(kiteWsUrl);
  kiteWs.binaryType = 'arraybuffer';

  // Buffer client messages until upstream Kite connection is ready
  const pendingMessages = [];
  let kiteReady = false;

  kiteWs.on('open', () => {
    console.log(`${ts()} ${GREEN}WS${RESET} upstream Kite connected ${GREY}[${userId}]${RESET}`);
    kiteReady = true;
    for (const { data, isBinary } of pendingMessages) {
      kiteWs.send(data, { binary: isBinary });
    }
    pendingMessages.length = 0;
  });

  // Kite answers an expired or revoked access token with 403 on the handshake.
  // Clear the Kite session like the REST proxy does, and tell the client with
  // WS_SESSION_EXPIRED so it sends the user to login instead of reconnecting.
  kiteWs.on('unexpected-response', (_req, res) => {
    res.resume();
    console.log(`${ts()} ${RED}WS${RESET} upstream rejected: HTTP ${res.statusCode} ${GREY}[${userId}]${RESET}`);
    if (res.statusCode === 403) {
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

// ---------- Start ----------

async function start() {
  // Initialise PostgreSQL
  await initDb();

  // Score open trade signals from stored prices at startup and hourly, so
  // outcomes don't depend on someone opening that strike in the browser.
  const evaluateSignals = () => evaluateTradeSetupSignalOutcomes()
    .then((count) => { if (count > 0) console.log(`[OI History] Updated ${count} signal outcome(s)`); })
    .catch((err) => console.warn('[OI History] Signal outcome evaluation failed:', err.message));
  evaluateSignals();
  setInterval(evaluateSignals, 60 * 60 * 1000).unref();

  // Fetch tracked scrips' OI history after the close so no trading day is missed.
  startOiHistoryScheduler();
  // Then update watchlist stocks' daily candles and scan them for setups.
  startStockSetupScheduler();
  // Run every file in server/jobs/nightly/ from 22:00 IST.
  startNightlyJobs();

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
