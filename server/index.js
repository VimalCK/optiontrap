/**
 * OptionTrap Backend Server
 *
 * Holds Kite API credentials securely and proxies all API/WebSocket
 * requests. The browser never sees apiSecret or accessToken.
 *
 * Endpoints:
 *   GET  /auth/me         — check if session is valid
 *   GET  /auth/login-url  — get Kite OAuth login URL
 *   POST /auth/token      — exchange request_token for session (sets httpOnly cookie)
 *   POST /auth/logout     — invalidate session + clear cookie
 *   ALL  /api/*           — proxy to api.kite.trade with auth injected
 *   WS   /ws              — proxy to wss://ws.kite.trade with auth injected
 */

import 'dotenv/config';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const KITE_API_KEY = process.env.KITE_API_KEY;
const KITE_API_SECRET = process.env.KITE_API_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!KITE_API_KEY || !KITE_API_SECRET) {
  console.error('[Server] KITE_API_KEY and KITE_API_SECRET must be set in .env');
  process.exit(1);
}

const app = express();
const server = createServer(app);

// ---------- Session Store ----------
// Keep a reference to the store so WebSocket upgrade can look up sessions
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

// ---------- Auth Routes ----------

app.get('/auth/me', (req, res) => {
  if (req.session.kiteSession) {
    const { accessToken, ...safe } = req.session.kiteSession;
    res.json({ status: 'ok', data: safe });
  } else {
    res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }
});

app.get('/auth/login-url', (_req, res) => {
  const url = `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}`;
  res.json({ url });
});

app.post('/auth/token', async (req, res) => {
  const { request_token } = req.body;
  if (!request_token) {
    return res.status(400).json({ status: 'error', message: 'request_token is required' });
  }

  try {
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
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

app.post('/auth/logout', async (req, res) => {
  const kiteSession = req.session.kiteSession;

  if (kiteSession) {
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
  next();
};

app.use('/api', requireAuth, createProxyMiddleware({
  target: 'https://api.kite.trade',
  changeOrigin: true,
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

  // Parse session cookie manually for WebSocket upgrade
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

  // Decode the signed cookie
  const sid = cookieParser.signedCookie(decodeURIComponent(rawSid), SESSION_SECRET);
  if (!sid || sid === rawSid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Look up session in the store
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
  const { accessToken } = clientWs._kiteSession;
  const kiteWsUrl = `wss://ws.kite.trade?api_key=${KITE_API_KEY}&access_token=${accessToken}`;

  const kiteWs = new WebSocket(kiteWsUrl);
  kiteWs.binaryType = 'arraybuffer';

  kiteWs.on('open', () => {
    console.log('[WS Proxy] Connected to Kite');
  });

  // Kite → Client
  kiteWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  // Client → Kite (subscribe/mode commands)
  clientWs.on('message', (data, isBinary) => {
    if (kiteWs.readyState === WebSocket.OPEN) {
      kiteWs.send(data, { binary: isBinary });
    }
  });

  kiteWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Kite disconnected');
    }
  });

  kiteWs.on('error', (err) => {
    console.error('[WS Proxy] Kite error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Upstream error');
    }
  });

  clientWs.on('close', () => {
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
  console.log(`[Server] API Key: ${KITE_API_KEY.slice(0, 4)}...${KITE_API_KEY.slice(-4)}`);
});
