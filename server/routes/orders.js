// Every paper trade, manual or automated, is an order through the order service (shared/paperOrders.js, shared/paperTradeRules.js).
import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { getOrders, getUserOpenOrders } from '../db.js';
import { parseRange } from '../positionsQuery.js';
import { tradeEngine } from '../tradeEngine/index.js';
import { OrderStatus } from '../../shared/tradeEnums.js';
import { sendError, sendOk } from '../replies.js';
import { sendResult } from './sendResult.js';

export const orderRoutes = asyncRouter();

// The user's orders, newest first: ?status=Open for every open one (whenever it
// was placed), else those placed in ?from=…&to=… (market days, both required).
orderRoutes.get('/api/orders', subscriber, async (req, res) => {
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
orderRoutes.post('/api/orders', subscriber, withFailureMessage('Failed to place the order', async (req, res) => {
  const { userId, apiKey, accessToken } = req.session.kiteSession;
  const body = req.body || {};
  const kite = { apiKey, accessToken };
  const { orders } = tradeEngine.services;
  const result = body.positionId !== undefined
    ? await orders.exit(userId, String(body.positionId), { exitPrice: body.exitPrice, kite })
    : await orders.place(userId, body, kite);
  sendResult(res, result, { data: result.order, created: true });
}));

// Cancel an open order: the only change an order takes, { status: 'Cancelled' }.
orderRoutes.patch('/api/orders/:id', subscriber, async (req, res) => {
  if (req.body?.status !== OrderStatus.Cancelled) return sendError(res, 400, `status must be '${OrderStatus.Cancelled}'`);
  const result = await tradeEngine.services.orders.cancel(req.session.kiteSession.userId, req.params.id);
  sendResult(res, result, { data: result.order });
});
