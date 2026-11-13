/**
 * Credentials (apiKey + apiSecret) are sent with the OAuth token exchange and discarded; the server never stores them.
 */
import crypto from 'crypto';
import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { getSafeSession } from '../authMiddleware.js';
import { deleteUser, isUserAdmin, upsertUser } from '../db.js';
import { KiteApiError, kiteClient } from '../kiteClient.js';
import { kiteLoginUrl } from '../kiteLogin.js';
import { startLoggedInSession } from '../loginSession.js';
import { CYAN, GREEN, RED, RESET, ts } from '../logStyle.js';
import { SESSION_COOKIE } from '../serverConfig.js';
import { sendError, sendOk } from '../replies.js';

export const authRoutes = asyncRouter();

authRoutes.get('/auth/status', withFailureMessage('Failed to load auth status', async (req, res) => {
  const activeSession = req.session?.kiteSession;
  if (!activeSession) return sendOk(res, null, { authenticated: false });
  sendOk(res, await getSafeSession(activeSession), { authenticated: true });
}));

// apiKey comes from the client (stored in localStorage)
authRoutes.get('/auth/login-url', (req, res) => {
  const { url, error } = kiteLoginUrl(req.query.api_key);
  if (error) return sendError(res, 400, error);
  sendOk(res, { url });
});

authRoutes.get('/auth/me', withFailureMessage('Failed to load session', async (req, res) => {
  if (!req.session?.kiteSession) return sendError(res, 401, 'Not authenticated');
  sendOk(res, await getSafeSession(req.session.kiteSession));
}));

authRoutes.post('/auth/token', withFailureMessage('Login failed on the server · try again', async (req, res) => {
  const { request_token, apiKey, apiSecret } = req.body;

  if (!request_token || !apiKey || !apiSecret) {
    return sendError(res, 400, 'request_token, apiKey, and apiSecret are required');
  }

  if (req.session?.kiteSession) {
    delete req.session.kiteSession;
    await new Promise((resolve) => req.session.save(resolve));
  }

  console.log(`${ts()} ${CYAN}AUTH${RESET} token exchange for ${apiKey.slice(0, 4)}...`);
  const checksum = crypto.createHash('sha256').update(apiKey + request_token + apiSecret).digest('hex');

  let data;
  try {
    data = await kiteClient().postForm('/session/token', { api_key: apiKey, request_token, checksum });
  } catch (err) {
    if (!(err instanceof KiteApiError)) throw err;
    console.error(`${ts()} ${RED}AUTH${RESET} exchange failed: ${err.status} ${err.message}`);
    return sendError(res, err.status, err.kiteMessage ?? `Kite token exchange failed (${err.status})`);
  }

  await upsertUser(data.user_id, data.user_name);

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
    // Admins bypass subscription checks and unlock the admin inbox.
    isAdmin: await isUserAdmin(data.user_id),
  };

  const safe = await getSafeSession(kiteSession);
  // A new session ID per login (see loginSession.js).
  await startLoggedInSession(req, kiteSession);
  console.log(`${ts()} ${GREEN}AUTH${RESET} logged in: ${data.user_id} (${data.user_name})`);
  sendOk(res, safe);
}));

authRoutes.post('/auth/logout', async (req, res) => {
  const kiteSession = req.session?.kiteSession;

  if (kiteSession?.apiKey && kiteSession?.accessToken) {
    // Kite-side errors don't stop the logout.
    await kiteClient(kiteSession).delete('/session/token').catch(() => {});
  }

  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE);
    sendOk(res);
  });
});

authRoutes.delete('/auth/account', async (req, res) => {
  const kiteSession = req.session?.kiteSession;
  const userId = kiteSession?.userId;

  if (!userId) {
    return sendError(res, 400, 'No account found to delete');
  }

  if (kiteSession?.accessToken) {
    kiteClient(kiteSession).delete('/session/token').catch(() => {}); // Kite-side errors don't stop the deletion
  }

  await deleteUser(userId);

  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE);
    console.log(`${ts()} ${RED}AUTH${RESET} account deleted: ${userId}`);
    sendOk(res);
  });
});
