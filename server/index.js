import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { FRONTEND_ORIGIN, IS_PROD, PORT, SESSION_COOKIE, SESSION_SECRET } from './serverConfig.js';
import { initDb, closeDb } from './db.js';
import { readKiteBody } from './kiteErrors.js';
import { KITE_API_URL, kiteHeaders } from './kiteClient.js';
import { isKiteAuthFailure } from '../shared/kiteAuth.js';
import { PostgresSessionStore } from './sessionStore.js';
import { clientIp, createRateLimiter } from './rateLimit.js';
import { checkSubscriptionAccess } from './subscriptionAccess.js';
import { accessDeps, requireAuth, requireSubscription } from './authMiddleware.js';
import { tradeEngine } from './tradeEngine/index.js';
import { scheduledJobs } from './scheduledJobs.js';
import { catchAsyncErrors, sendServerError } from './asyncRoutes.js';
import { securityHeaders } from './securityHeaders.js';
import { signedSessionId } from './wsSessionCookie.js';
import { isSameSiteWsOrigin } from './wsOrigin.js';
import { kiteTickerUrl } from './kiteTickerFeed.js';
import { createConcurrencyLimit } from './concurrencyLimit.js';
import { allowOnlyKnownKiteCalls } from './kiteProxyAllowlist.js';
import { MAX_CLIENT_MESSAGE_BYTES, MAX_CONNECTIONS_PER_USER } from './wsLimits.js';
import { CYAN, GREEN, GREY, RED, RESET, YELLOW, ts } from './logStyle.js';
import { ROUTERS } from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
catchAsyncErrors(app);

if (IS_PROD) {
  app.set('trust proxy', 1);
}

const sessionStore = new PostgresSessionStore();

const sessionMiddleware = session({
  store: sessionStore,
  name: SESSION_COOKIE,
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

for (const router of ROUTERS) app.use(router);

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

  const sid = signedSessionId(request.headers.cookie, SESSION_COOKIE, SESSION_SECRET);
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

async function start() {
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
