import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { createConcurrencyLimit } from '../concurrencyLimit.js';
import {
  addReplayTrade,
  createReplaySession,
  finishReplaySession,
  getOpenReplaySession,
  getReplaySessions,
  getReplayStats,
} from '../db.js';
import { ReplayDayError, fetchReplayDay } from '../replayDay.js';
import { ReplaySessionStatus } from '../../shared/appEnums.js';
import { parseReplaySessionInput, parseReplayTradeInput, replayTradeResult } from '../../shared/replay.js';
import { sendCreated, sendError, sendOk } from '../replies.js';

export const replayRoutes = asyncRouter();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A day range from ?from=&to= (both required, from ≤ to), or the reason it isn't one. */
function dayRange(query) {
  const { from, to } = query;
  if (!DATE_PATTERN.test(String(from ?? '')) || !DATE_PATTERN.test(String(to ?? ''))) return { error: 'from and to must be YYYY-MM-DD' };
  if (from > to) return { error: 'from must not be after to' };
  return { from: String(from), to: String(to) };
}

const underlyingFilter = (query) => (typeof query.underlying === 'string' && query.underlying ? query.underlying : null);

/** One day fetch per user at a time: each makes a few dozen Kite calls. */
const dayFetches = createConcurrencyLimit(1);

// GET /api/replay-days/:date?underlying=NIFTY: the day's minute candles for the replay, fetched from Kite.
replayRoutes.get('/api/replay-days/:date', subscriber, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  if (!underlyingFilter(req.query)) return sendError(res, 400, 'underlying is required');
  if (!dayFetches.tryAcquire(userId)) return sendError(res, 429, 'A replay day is already loading · wait for it to finish');
  const cancel = new AbortController();
  res.on('close', () => { if (!res.writableEnded) cancel.abort(); });
  try {
    const { apiKey, accessToken } = req.session.kiteSession;
    sendOk(res, await fetchReplayDay({ kite: { apiKey, accessToken }, underlyingName: req.query.underlying, date: req.params.date, signal: cancel.signal }));
  } catch (err) {
    if (cancel.signal.aborted) return;
    if (err.authFailure) return sendError(res, 401, 'Your Kite login has ended · log in again');
    if (err instanceof ReplayDayError) return sendError(res, 400, err.message);
    if (err.kiteMessage) return sendError(res, 502, `Kite refused the replay data: ${err.kiteMessage}`);
    console.error('[Replay] Day fetch failed:', err);
    sendError(res, 500, 'Failed to load the replay day');
  } finally {
    dayFetches.release(userId);
  }
});

// GET /api/replay-sessions?from=&to=[&underlying=]: the user's sessions whose day is in the range.
replayRoutes.get('/api/replay-sessions', subscriber, withFailureMessage('Failed to load replay sessions', async (req, res) => {
  const range = dayRange(req.query);
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getReplaySessions(req.session.kiteSession.userId, { ...range, underlying: underlyingFilter(req.query) }));
}));

// POST /api/replay-sessions { underlying, date, expiry, lotSize }: starts the user's next playthrough of that day.
replayRoutes.post('/api/replay-sessions', subscriber, withFailureMessage('Failed to start the replay session', async (req, res) => {
  const parsed = parseReplaySessionInput(req.body);
  if ('error' in parsed) return sendError(res, 400, parsed.error);
  sendCreated(res, await createReplaySession(req.session.kiteSession.userId, parsed.value));
}));

// PATCH /api/replay-sessions/:id { status: 'Finished' }: the session reached the close.
replayRoutes.patch('/api/replay-sessions/:id', subscriber, withFailureMessage('Failed to finish the replay session', async (req, res) => {
  if (req.body?.status !== ReplaySessionStatus.Finished) return sendError(res, 400, `status must be '${ReplaySessionStatus.Finished}'`);
  const session = await finishReplaySession(req.params.id, req.session.kiteSession.userId);
  if (!session) return sendError(res, 404, 'Open replay session not found');
  sendOk(res, session);
}));

// POST /api/replay-sessions/:id/trades { optionType, strike, …, entryPrice, exitPrice }: records a closed trade.
replayRoutes.post('/api/replay-sessions/:id/trades', subscriber, withFailureMessage('Failed to save the replay trade', async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const parsed = parseReplayTradeInput(req.body);
  if ('error' in parsed) return sendError(res, 400, parsed.error);
  const session = await getOpenReplaySession(req.params.id, userId);
  if (!session) return sendError(res, 404, 'Open replay session not found');
  const trade = parsed.value;
  const quantity = trade.lots * session.lotSize;
  const result = replayTradeResult({ date: session.date, ...trade, quantity });
  const saved = await addReplayTrade(userId, session.id, { ...trade, quantity, ...result });
  if (!saved) return sendError(res, 404, 'Open replay session not found');
  sendCreated(res, saved);
}));

// GET /api/replay-stats?from=&to=[&underlying=]: results of the user's first-attempt trades in the range.
replayRoutes.get('/api/replay-stats', subscriber, withFailureMessage('Failed to load replay results', async (req, res) => {
  const range = dayRange(req.query);
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getReplayStats(req.session.kiteSession.userId, { ...range, underlying: underlyingFilter(req.query) }));
}));
