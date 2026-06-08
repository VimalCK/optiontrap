/**
 * OptionTrap Backend Server
 *
 * Holds Kite API credentials securely and proxies all API/WebSocket
 * requests. The browser never sees apiSecret or accessToken.
 *
 * Credentials are configured via the login UI and persisted to
 * server/credentials.json (gitignored). No manual .env editing required.
 *
 * Endpoints:
 *   GET  /auth/status      — check if credentials are configured + session valid
 *   GET  /auth/login-url   — get Kite OAuth login URL
 *   POST /auth/credentials — save API key + secret (from login UI)
 *   POST /auth/token       — exchange request_token for session (sets httpOnly cookie)
 *   POST /auth/logout      — invalidate session + clear cookie
 *   ALL  /api/*            — proxy to api.kite.trade with auth injected
 *   WS   /ws               — proxy to wss://ws.kite.trade with auth injected
 */

import 'dotenv/config';

// Disable TLS cert verification for outbound requests to Kite API.
// Required on Windows where Node.js doesn't use the system certificate store.
// Acceptable for a personal tool connecting to known endpoints (api.kite.trade).
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// ---------- Credential Management ----------

let KITE_API_KEY = '';
let KITE_API_SECRET = '';

function loadCredentials() {
  // Try credentials.json first (set via UI)
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
      if (data.apiKey && data.apiSecret) {
        KITE_API_KEY = data.apiKey;
        KITE_API_SECRET = data.apiSecret;
        console.log('[Server] Credentials loaded from credentials.json');
        return;
      }
    } catch {
      console.warn('[Server] Failed to parse credentials.json');
    }
  }

  // Fallback to .env (for backward compat)
  if (process.env.KITE_API_KEY && process.env.KITE_API_SECRET) {
    KITE_API_KEY = process.env.KITE_API_KEY;
    KITE_API_SECRET = process.env.KITE_API_SECRET;
    console.log('[Server] Credentials loaded from .env');
    return;
  }

  console.log('[Server] No credentials configured — waiting for UI setup');
}

function saveCredentials(apiKey, apiSecret) {
  KITE_API_KEY = apiKey;
  KITE_API_SECRET = apiSecret;
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ apiKey, apiSecret }, null, 2), 'utf-8');
  console.log('[Server] Credentials saved to credentials.json');
}

function hasCredentials() {
  return KITE_API_KEY.length > 0 && KITE_API_SECRET.length > 0;
}

// Load on startup
loadCredentials();

// ---------- Express App ----------

const app = express();
const server = createServer(app);

const sessionStore = new session.MemoryStore();

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
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
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

// ---------- Request Logger ----------

const GREY = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? RED : status >= 400 ? YELLOW : status >= 300 ? CYAN : GREEN;
    const user = req.session?.kiteSession?.userId || '-';
    console.log(
      `${GREY}${new Date().toLocaleTimeString()}${RESET} ${color}${status}${RESET} ${method} ${originalUrl} ${GREY}${duration}ms${RESET} ${GREY}[${user}]${RESET}`
    );
  });

  next();
});

// ---------- Auth Routes ----------

// Combined status check: are credentials configured + is session valid?
app.get('/auth/status', (req, res) => {
  const credentialsConfigured = hasCredentials();
  const session = req.session.kiteSession;

  if (session) {
    const { accessToken, ...safe } = session;
    res.json({ status: 'ok', credentialsConfigured, authenticated: true, data: safe });
  } else {
    res.json({ status: 'ok', credentialsConfigured, authenticated: false, data: null });
  }
});

// Save credentials (called from login UI)
app.post('/auth/credentials', (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ status: 'error', message: 'apiKey and apiSecret are required' });
  }

  saveCredentials(apiKey.trim(), apiSecret.trim());

  // Destroy any existing session since credentials changed
  if (req.session.kiteSession) {
    req.session.destroy(() => {});
  }

  res.json({ status: 'ok', message: 'Credentials saved' });
});

// Get Kite OAuth login URL
app.get('/auth/login-url', (_req, res) => {
  if (!hasCredentials()) {
    return res.status(400).json({ status: 'error', message: 'Credentials not configured' });
  }
  const url = `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}`;
  res.json({ url });
});

// Check session (backward compat with useKiteSession)
app.get('/auth/me', (req, res) => {
  if (req.session.kiteSession) {
    const { accessToken, ...safe } = req.session.kiteSession;
    res.json({ status: 'ok', data: safe });
  } else {
    res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }
});

// Exchange request_token for access_token
app.post('/auth/token', async (req, res) => {
  if (!hasCredentials()) {
    return res.status(400).json({ status: 'error', message: 'Credentials not configured' });
  }

  const { request_token } = req.body;
  if (!request_token) {
    return res.status(400).json({ status: 'error', message: 'request_token is required' });
  }

  try {
    console.log('[Auth] Exchanging token. API Key:', KITE_API_KEY.slice(0, 4) + '...');
    console.log('[Auth] Request token:', request_token.slice(0, 8) + '...');
    const checksumInput = KITE_API_KEY + request_token + KITE_API_SECRET;
    const checksum = crypto.createHash('sha256').update(checksumInput).digest('hex');

    const response = await fetch('https://api.kite.trade/session/token', {
      method: 'POST',
      headers: {
        'X-Kite-Version': '3',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        api_key: KITE_API_KEY,
        request_token,
        checksum,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Auth] Token exchange failed:', response.status, errorText);
      return res.status(response.status).json({
        status: 'error',
        message: `Kite token exchange failed (${response.status})`,
      });
    }

    const result = await response.json();
    const data = result.data;

    req.session.kiteSession = {
      accessToken: data.access_token,
      userId: data.user_id,
      userName: data.user_name,
      userShortname: data.user_shortname,
      email: data.email,
      broker: data.broker,
      loginTime: data.login_time,
      avatarUrl: data.avatar_url || null,
    };

    const { accessToken, ...safe } = req.session.kiteSession;
    res.json({ status: 'ok', data: safe });
  } catch (err) {
    console.error('[Auth] Token exchange error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message: `Token exchange error: ${errMsg}` });
  }
});

// Logout
app.post('/auth/logout', async (req, res) => {
  const kiteSession = req.session.kiteSession;

  if (kiteSession && hasCredentials()) {
    try {
      await fetch('https://api.kite.trade/session/token', {
        method: 'DELETE',
        headers: {
          'X-Kite-Version': '3',
          'Authorization': `token ${KITE_API_KEY}:${kiteSession.accessToken}`,
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

// ---------- API Proxy ----------

const requireAuth = (req, res, next) => {
  if (!req.session?.kiteSession) {
    return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }
  if (!hasCredentials()) {
    return res.status(503).json({ status: 'error', message: 'Server credentials not configured' });
  }
  next();
};

app.use('/api', requireAuth, createProxyMiddleware({
  target: 'https://api.kite.trade',
  changeOrigin: true,
  secure: false,
  pathRewrite: { '^/api': '' },
  on: {
    proxyReq: (proxyReq, req) => {
      const token = req.session.kiteSession.accessToken;
      proxyReq.setHeader('Authorization', `token ${KITE_API_KEY}:${token}`);
      proxyReq.setHeader('X-Kite-Version', '3');
    },
    proxyRes: (proxyRes, req) => {
      if (proxyRes.statusCode === 403) {
        req.session.destroy(() => {});
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
    if (err || !sessionData || !sessionData.kiteSession) {
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
  if (!hasCredentials()) {
    console.log(`${GREY}${new Date().toLocaleTimeString()}${RESET} ${RED}WS${RESET} rejected — no credentials`);
    clientWs.close(4003, 'Server credentials not configured');
    return;
  }

  const userId = clientWs._kiteSession?.userId || '-';
  console.log(`${GREY}${new Date().toLocaleTimeString()}${RESET} ${GREEN}WS${RESET} connected ${GREY}[${userId}]${RESET}`);

  const { accessToken } = clientWs._kiteSession;
  const kiteWsUrl = `wss://ws.kite.trade?api_key=${KITE_API_KEY}&access_token=${accessToken}`;

  const kiteWs = new WebSocket(kiteWsUrl);
  kiteWs.binaryType = 'arraybuffer';

  // Buffer client messages that arrive before upstream Kite connection is ready
  const pendingMessages = [];
  let kiteReady = false;

  kiteWs.on('open', () => {
    console.log(`${GREY}${new Date().toLocaleTimeString()}${RESET} ${GREEN}WS${RESET} upstream Kite connected ${GREY}[${userId}]${RESET}`);
    kiteReady = true;
    // Flush any buffered subscribe/mode commands
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
      // Kite not connected yet — buffer for later
      pendingMessages.push({ data, isBinary });
    }
  });

  kiteWs.on('close', () => {
    console.log(`${GREY}${new Date().toLocaleTimeString()}${RESET} ${YELLOW}WS${RESET} upstream Kite disconnected ${GREY}[${userId}]${RESET}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Kite disconnected');
    }
  });

  kiteWs.on('error', (err) => {
    console.log(`${GREY}${new Date().toLocaleTimeString()}${RESET} ${RED}WS${RESET} upstream error: ${err.message} ${GREY}[${userId}]${RESET}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Upstream error');
    }
  });

  clientWs.on('close', () => {
    console.log(`${GREY}${new Date().toLocaleTimeString()}${RESET} ${YELLOW}WS${RESET} client disconnected ${GREY}[${userId}]${RESET}`);
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

server.listen(PORT, () => {
  console.log(`[Server] OptionTrap backend running on port ${PORT}`);
  console.log(`[Server] Mode: ${IS_PROD ? 'production' : 'development'}`);
  if (hasCredentials()) {
    console.log(`[Server] API Key: ${KITE_API_KEY.slice(0, 4)}...${KITE_API_KEY.slice(-4)}`);
  } else {
    console.log('[Server] Credentials not yet configured — visit the app to set up');
  }
});
