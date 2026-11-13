import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { getLatestOiSnapshotTimestamp, getTodayOiSnapshots } from '../db.js';
import { watchOiSnapshotSymbol } from '../oiSnapshotScheduler.js';
import { sendError, sendOk } from '../replies.js';

export const oiSnapshotRoutes = asyncRouter();

oiSnapshotRoutes.get('/api/oi-snapshots', subscriber, withFailureMessage('Failed to load OI snapshots', async (_req, res) => {
  sendOk(res, await getTodayOiSnapshots());
}));

oiSnapshotRoutes.get('/api/oi-snapshots/latest', subscriber, withFailureMessage('Failed to load the latest OI snapshot time', async (_req, res) => {
  sendOk(res, { timestamp: await getLatestOiSnapshotTimestamp() });
}));

// Snapshot a symbol's option chain for the rest of today (the always-snapshot
// symbols always are). The analyzer calls this when a symbol is opened; the first
// snapshot is taken before responding so the chart has data straight away.
oiSnapshotRoutes.post('/api/oi-snapshots/watched-symbols', subscriber, withFailureMessage('Failed to start snapshots for this symbol', async (req, res) => {
  const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9&_-]{1,30}$/.test(symbol)) {
    return sendError(res, 400, 'A valid symbol is required');
  }
  sendOk(res, await watchOiSnapshotSymbol(symbol));
}));
