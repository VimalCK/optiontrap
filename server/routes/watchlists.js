import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  getWatchlistItems,
  getWatchlists,
  removeWatchlistItem,
  renameWatchlist,
  reorderWatchlistItems,
} from '../db.js';
import { Exchange } from '../../shared/tradeEnums.js';
import { sendCreated, sendError, sendOk } from '../replies.js';

export const watchlistRoutes = asyncRouter();

watchlistRoutes.get('/api/watchlists', subscriber, async (req, res) => {
  sendOk(res, await getWatchlists(req.session.kiteSession.userId));
});

watchlistRoutes.get('/api/watchlists/:id', subscriber, async (req, res) => {
  const list = await getWatchlistItems(req.params.id, req.session.kiteSession.userId);
  if (!list) return sendError(res, 404, 'Watchlist not found');
  sendOk(res, list);
});

watchlistRoutes.post('/api/watchlists', subscriber, async (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return sendError(res, 400, 'Watchlist name is required');
  }
  sendCreated(res, await createWatchlist(req.session.kiteSession.userId, name));
});

watchlistRoutes.patch('/api/watchlists/:id', subscriber, async (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return sendError(res, 400, 'Name is required');
  }
  const updated = await renameWatchlist(req.params.id, req.session.kiteSession.userId, name);
  if (!updated) return sendError(res, 404, 'Watchlist not found');
  sendOk(res);
});

watchlistRoutes.delete('/api/watchlists/:id', subscriber, async (req, res) => {
  const deleted = await deleteWatchlist(req.params.id, req.session.kiteSession.userId);
  if (!deleted) return sendError(res, 404, 'Watchlist not found');
  sendOk(res);
});

watchlistRoutes.post('/api/watchlists/:id/items', subscriber, async (req, res) => {
  const { instrumentToken, tradingsymbol, exchange } = req.body;

  if (!instrumentToken || !tradingsymbol) {
    return sendError(res, 400, 'instrumentToken and tradingsymbol are required');
  }

  const item = await addWatchlistItem(req.params.id, req.session.kiteSession.userId, {
    instrumentToken: Number(instrumentToken),
    tradingsymbol,
    exchange: exchange || Exchange.NSE,
  });

  if (!item) {
    return sendError(res, 400, 'Limit reached (100), duplicate instrument, or watchlist not found');
  }

  sendCreated(res, item);
});

watchlistRoutes.put('/api/watchlists/:id/items/order', subscriber, withFailureMessage('Failed to save the watchlist order', async (req, res) => {
  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) {
    return sendError(res, 400, 'itemIds must be a list of item ids');
  }

  const saved = await reorderWatchlistItems(req.params.id, req.session.kiteSession.userId, itemIds);
  if (!saved) {
    return sendError(res, 400, 'Watchlist not found, or the items changed: reload and try again');
  }
  sendOk(res);
}));

watchlistRoutes.delete('/api/watchlists/:id/items/:itemId', subscriber, async (req, res) => {
  const removed = await removeWatchlistItem(req.params.itemId, req.session.kiteSession.userId);
  if (!removed) return sendError(res, 404, 'Item not found');
  sendOk(res);
});
