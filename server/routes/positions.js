import { asyncRouter } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { getDailyPnl, getPositionStats, getPositions } from '../db.js';
import { parseDailyPnlQuery, parsePositionsQuery, parseStatsQuery } from '../positionsQuery.js';
import { sendError, sendOk } from '../replies.js';

export const positionRoutes = asyncRouter();

positionRoutes.get('/api/positions', subscriber, async (req, res) => {
  const { filter, error } = parsePositionsQuery(req.query);
  if (error) return sendError(res, 400, error);
  sendOk(res, await getPositions(req.session.kiteSession.userId, filter));
});

positionRoutes.get('/api/positions/daily-pnl', subscriber, async (req, res) => {
  const { filter, error } = parseDailyPnlQuery(req.query);
  if (error) return sendError(res, 400, error);
  sendOk(res, await getDailyPnl(req.session.kiteSession.userId, filter));
});

positionRoutes.get('/api/positions/stats', subscriber, async (req, res) => {
  const { filter, error } = parseStatsQuery(req.query);
  if (error) return sendError(res, 400, error);
  sendOk(res, await getPositionStats(req.session.kiteSession.userId, filter));
});
