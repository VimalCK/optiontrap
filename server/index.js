/**
 * OptionTrap Backend Server
 *
 * Multi-user server that securely manages per-user Kite API credentials.
 * Each user's api_secret is AES-256-GCM encrypted in SQLite. The browser
 * never sees apiSecret or accessToken — all sensitive operations happen
 * server-side.
 *
 * A signed persistent cookie (optiontrap_remember) remembers returning
 * users so they only need to click "Login with Kite" each day instead of
 * re-entering credentials.
 *
 * Endpoints:
 *   GET  /auth/status      — credentials configured (via cookie) + session
 *   GET  /auth/login-url   — Kite OAuth URL using per-user api_key
 *   POST /auth/credentials — save api_key + secret (session temp → SQLite after OAuth)
 *   POST /auth/token       — exchange request_token, persist credentials, set cookie
 *   POST /auth/logout      — invalidate session, keep remember cookie
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
  saveCredentials,
  getCredentialsByApiKey,
  deleteCredentials,
  migrateFromJson,
  createWatchlist,
  getWatchlists,
  getWatchlistItems,
  renameWatchlist,
  deleteWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
} from './db.js';
import { SqliteSessionStore } from './sessionStore.js';
import { createRateLimiter } from './rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';
const CREDENTIALS_JSON_PATH = path.join(__dirname, 'credentials.json');

const REMEMBER_COOKIE = 'optiontrap_remember';
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

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

// ---------- Resolve per-user credentials ----------

/**
 * Look up credentials for the current request. Checks (in order):
 *   1. Active session (kiteSession.apiKey)
 *   2. Pending credentials in session (just saved, pre-OAuth)
 *   3. Persistent remember cookie → SQLite lookup
 *
 * Returns { apiKey, apiSecret } or null.
 */
function resolveCredentials(req) {
  // 1. Active session
  const apiKey = req.session?.kiteSession?.apiKey;
  if (apiKey) {
    const creds = getCredentialsByApiKey(apiKey);
    if (creds) return creds;
  }

  // 2. Pending (just entered, not yet OAuth'd)
  const pending = req.session?.pendingCredentials;
  if (pending?.apiKey && pending?.apiSecret) {
    return { apiKey: pending.apiKey, apiSecret: pending.apiSecret };
  }

  // 3. Remember cookie
  const rememberedKey = req.signedCookies?.[REMEMBER_COOKIE];
  if (rememberedKey) {
    const creds = getCredentialsByApiKey(rememberedKey);
    if (creds) return creds;
  }

  return null;
}

// ---------- Express App ----------

const app = express();
const server = createServer(app);

const sessionStore = new SqliteSessionStore();

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

// Combined status: are credentials available + is session active?
app.get('/auth/status', (req, res) => {
  const activeSession = req.session?.kiteSession || null;
  const creds = resolveCredentials(req);

  if (activeSession) {
    const { accessToken, apiKey, ...safe } = activeSession;
    res.json({
      status: 'ok',
      credentialsConfigured: true,
      authenticated: true,
      data: safe,
    });
  } else {
    res.json({
      status: 'ok',
      credentialsConfigured: creds !== null,
      authenticated: false,
      data: null,
    });
  }
});

// Save credentials — stored in session until OAuth completes
app.post('/auth/credentials', (req, res) => {
  const { apiKey, apiSecret } = req.body;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      status: 'error',
      message: 'apiKey and apiSecret are required',
    });
  }

  const trimmedKey = apiKey.trim();
  const trimmedSecret = apiSecret.trim();

  // Store temporarily in session (persisted to SQLite after successful OAuth)
  req.session.pendingCredentials = {
    apiKey: trimmedKey,
    apiSecret: trimmedSecret,
  };

  // Destroy any active Kite session — new credentials mean fresh login
  if (req.session.kiteSession) {
    delete req.session.kiteSession;
  }

  res.json({ status: 'ok', message: 'Credentials saved' });
});

// Get Kite OAuth login URL
app.get('/auth/login-url', (req, res) => {
  const creds = resolveCredentials(req);

  if (!creds) {
    return res.status(400).json({
      status: 'error',
      message: 'No credentials available. Please save credentials first.',
    });
  }

  // Ensure credentials are in session for the upcoming token exchange
  if (!req.session.pendingCredentials) {
    req.session.pendingCredentials = {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    };
  }

  const url = `https://kite.zerodha.com/connect/login?v=3&api_key=${creds.apiKey}`;
  res.json({ url });
});

// Check session (backward compat with useKiteSession)
app.get('/auth/me', (req, res) => {
  if (req.session?.kiteSession) {
    const { accessToken, apiKey, ...safe } = req.session.kiteSession;
    res.json({ status: 'ok', data: safe });
  } else {
    res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }
});

// Exchange request_token for access_token
app.post('/auth/token', async (req, res) => {
  const { request_token } = req.body;

  if (!request_token) {
    return res.status(400).json({
      status: 'error',
      message: 'request_token is required',
    });
  }

  // Resolve credentials: session pending → remember cookie → fail
  const creds = resolveCredentials(req);

  if (!creds) {
    return res.status(400).json({
      status: 'error',
      message: 'No credentials found. Please save your API key and secret first.',
    });
  }

  const { apiKey, apiSecret } = creds;

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
      return res.status(response.status).json({
        status: 'error',
        message: `Kite token exchange failed (${response.status})`,
      });
    }

    const result = await response.json();
    const data = result.data;

    // 1. Persist credentials to SQLite (encrypted) with user identity
    saveCredentials(apiKey, apiSecret, data.user_id, data.user_name);

    // 2. Set active session with per-user api_key
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
    };

    // 3. Clear pending credentials (now persisted in SQLite)
    delete req.session.pendingCredentials;

    // 4. Set persistent remember cookie (survives session expiry)
    res.cookie(REMEMBER_COOKIE, apiKey, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      maxAge: REMEMBER_MAX_AGE,
      signed: true,
    });

    const { accessToken: _tok, apiKey: _key, ...safe } = req.session.kiteSession;
    console.log(`${ts()} ${GREEN}AUTH${RESET} logged in: ${data.user_id} (${data.user_name})`);
    res.json({ status: 'ok', data: safe });
  } catch (err) {
    console.error(`${ts()} ${RED}AUTH${RESET} exchange error:`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message: `Token exchange error: ${errMsg}` });
  }
});

// Logout — destroy session but keep remember cookie for easy re-login
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
    // Intentionally NOT clearing optiontrap_remember — user can re-login
    // without re-entering credentials next time
    res.json({ status: 'ok' });
  });
});

// Delete account — permanently remove credentials from SQLite, destroy session, clear cookies
app.delete('/auth/account', (req, res) => {
  const kiteSession = req.session?.kiteSession;
  const apiKey = kiteSession?.apiKey || req.signedCookies?.[REMEMBER_COOKIE];

  if (!apiKey) {
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

  // Delete credentials from SQLite
  deleteCredentials(apiKey);

  // Destroy session + clear all cookies
  req.session.destroy(() => {
    res.clearCookie('optiontrap_sid');
    res.clearCookie(REMEMBER_COOKIE);
    console.log(`${ts()} ${RED}AUTH${RESET} account deleted: ${kiteSession?.userId || apiKey}`);
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

// ---------- Watchlist Routes ----------

app.get('/watchlist', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const lists = getWatchlists(userId);
  res.json({ status: 'ok', data: lists });
});

app.get('/watchlist/:id', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const list = getWatchlistItems(req.params.id, userId);

  if (!list) {
    return res.status(404).json({ status: 'error', message: 'Watchlist not found' });
  }

  res.json({ status: 'ok', data: list });
});

app.post('/watchlist', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Watchlist name is required' });
  }

  const list = createWatchlist(userId, name);
  res.json({ status: 'ok', data: list });
});

app.put('/watchlist/:id', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Name is required' });
  }

  const updated = renameWatchlist(req.params.id, userId, name);
  if (!updated) {
    return res.status(404).json({ status: 'error', message: 'Watchlist not found' });
  }

  res.json({ status: 'ok' });
});

app.delete('/watchlist/:id', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const deleted = deleteWatchlist(req.params.id, userId);

  if (!deleted) {
    return res.status(404).json({ status: 'error', message: 'Watchlist not found' });
  }

  res.json({ status: 'ok' });
});

app.post('/watchlist/:id/items', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { instrumentToken, tradingsymbol, exchange } = req.body;

  if (!instrumentToken || !tradingsymbol) {
    return res.status(400).json({
      status: 'error',
      message: 'instrumentToken and tradingsymbol are required',
    });
  }

  const item = addWatchlistItem(req.params.id, userId, {
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

app.delete('/watchlist/:id/items/:itemId', requireAuth, (req, res) => {
  const userId = req.session.kiteSession.userId;
  const removed = removeWatchlistItem(req.params.itemId, userId);

  if (!removed) {
    return res.status(404).json({ status: 'error', message: 'Item not found' });
  }

  res.json({ status: 'ok' });
});

// ---------- API Proxy ----------

app.use('/api', requireAuth, apiLimiter, createProxyMiddleware({
  target: 'https://api.kite.trade',
  changeOrigin: true,
  secure: false,
  pathRewrite: { '^/api': '' },
  on: {
    proxyReq: (proxyReq, req) => {
      const { apiKey, accessToken } = req.session.kiteSession;
      proxyReq.setHeader('Authorization', `token ${apiKey}:${accessToken}`);
      proxyReq.setHeader('X-Kite-Version', '3');
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

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws._kiteSession = sessionData.kiteSession;
      wss.emit('connection', ws, request);
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
  // Initialise SQLite
  await initDb();

  // One-time migration from legacy single-user credentials.json
  migrateFromJson(CREDENTIALS_JSON_PATH);

  server.listen(PORT, () => {
    console.log(`${ts()} ${GREEN}Server${RESET} OptionTrap running on port ${PORT}`);
    console.log(`${ts()} ${GREEN}Server${RESET} Mode: ${IS_PROD ? 'production' : 'development'}`);
    console.log(`${ts()} ${GREEN}Server${RESET} Multi-user: credentials stored in SQLite (encrypted)`);
  });
}

// Graceful shutdown
function shutdown() {
  authLimiter.close();
  apiLimiter.close();
  generalLimiter.close();
  sessionStore.close();
  closeDb();
}

process.on('SIGINT', () => {
  console.log(`\n${ts()} ${YELLOW}Server${RESET} shutting down...`);
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
