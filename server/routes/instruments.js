import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { admin, subscriber } from '../authMiddleware.js';
import { getFnoSymbols, getUnderlyings, setAlwaysSnapshot } from '../db.js';
import { getOrFetchInstruments } from '../instruments.js';
import { sendError, sendOk } from '../replies.js';

export const instrumentRoutes = asyncRouter();

instrumentRoutes.get('/api/fno-symbols', subscriber, withFailureMessage('Failed to load F&O symbols', async (_req, res) => {
  sendOk(res, await getFnoSymbols());
}));

// F&O underlyings with their price instrument and display settings:
// [{ name, label, instrumentToken, exchange, tradingsymbol, tradingviewSymbol, alwaysSnapshot, isMarketReference, isIndex }]
instrumentRoutes.get('/api/underlyings', subscriber, withFailureMessage('Failed to load underlyings', async (_req, res) => {
  sendOk(res, await getUnderlyings());
}));

// Body { alwaysSnapshot: boolean }: OI-snapshot this underlying every trading day, or not.
instrumentRoutes.patch('/api/admin/underlyings/:name', admin, withFailureMessage('Failed to update the underlying', async (req, res) => {
  const { alwaysSnapshot } = req.body || {};
  if (typeof alwaysSnapshot !== 'boolean') {
    return sendError(res, 400, 'alwaysSnapshot must be true or false');
  }
  const underlying = await setAlwaysSnapshot(req.params.name, alwaysSnapshot);
  if (!underlying) return sendError(res, 404, `No price instrument for ${req.params.name}`);
  sendOk(res, underlying);
}));

instrumentRoutes.get('/api/instruments', subscriber, withFailureMessage('Failed to load instruments from Kite', async (req, res) => {
  const { apiKey, accessToken } = req.session.kiteSession;
  sendOk(res, await getOrFetchInstruments(apiKey, accessToken));
}, { status: 502 }));
