import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { getCashStock, getMarketReference, getStockCandles, getStockScansForUser, getStockSetupSignals, getStockSetupStats } from '../db.js';
import { backfillStockSetups, candleSyncWarning, scanStock, syncStockCandles } from '../stockCandles.js';
import { sendError, sendOk } from '../replies.js';

export const stockRoutes = asyncRouter();

/** Candles as compact [date, open, high, low, close, volume] rows: about half the JSON of objects. */
const compactCandles = (candles) => candles.map((c) => [c.date, c.open, c.high, c.low, c.close, c.volume]);

// Candles are brought up to date with the user's own Kite session first. If Kite fails but candles are stored,
// they are returned with a warning rather than an error.
stockRoutes.get('/api/stocks/:token/candles', subscriber, withFailureMessage('Failed to load daily candles', async (req, res) => {
  const token = Number(req.params.token);
  const stock = Number.isInteger(token) ? await getCashStock(token) : null;
  if (!stock) return sendError(res, 400, 'Entry and exit zones cover NSE and BSE cash stocks only');

  const kite = req.session.kiteSession;
  let warning = null;
  let synced = false;
  const reference = await getMarketReference();
  try {
    if (reference) await syncStockCandles(reference.instrumentToken, kite);
    const sync = await syncStockCandles(token, kite);
    synced = !sync.skipped;
  } catch (err) {
    console.warn(`[Stocks] Candle sync failed for ${stock.tradingsymbol}:`, err.message);
    warning = candleSyncWarning(err);
  }

  const [candles, market] = await Promise.all([getStockCandles(token), reference ? getStockCandles(reference.instrumentToken) : []]);
  if (!candles.length) {
    const message = warning ? `Couldn't load daily candles from Kite (${warning})` : 'Kite returned no daily candles for this stock';
    return sendError(res, 502, message);
  }
  // Keeps the watchlist's Setups column in step with the panel.
  if (synced) await scanStock(stock, market).catch((err) => console.warn(`[Stocks] Scan failed for ${stock.tradingsymbol}:`, err.message));

  sendOk(res, { stock, candles: compactCandles(candles), market: compactCandles(market), marketLabel: reference?.label ?? null, warning });
}));

// Fills the setup scorecard from one stock's past year, so a new stock doesn't wait weeks for the nightly scan.
stockRoutes.post('/api/stocks/:token/setup-history', subscriber, withFailureMessage('Failed to build the setup history', async (req, res) => {
  const token = Number(req.params.token);
  const stock = Number.isInteger(token) ? await getCashStock(token) : null;
  if (!stock) return sendError(res, 400, 'Setup history covers NSE and BSE cash stocks only');

  try {
    await syncStockCandles(token, req.session.kiteSession);
  } catch (err) {
    console.warn(`[Stocks] Candle sync before setup history failed for ${stock.tradingsymbol}:`, err.message);
  }
  if (!(await getStockCandles(token)).length) {
    return sendError(res, 502, 'No daily candles stored for this stock and Kite could not supply them');
  }

  const counts = await backfillStockSetups(stock);
  console.log(`[Stocks] Setup history for ${stock.tradingsymbol}: ${counts.found} setup(s)`);
  sendOk(res, counts);
}));

stockRoutes.get('/api/stocks/scans', subscriber, withFailureMessage('Failed to load stock scans', async (req, res) => {
  sendOk(res, await getStockScansForUser(req.session.kiteSession.userId));
}));

stockRoutes.get('/api/stocks/:token/setups', subscriber, withFailureMessage('Failed to load stock setups', async (req, res) => {
  const token = Number(req.params.token);
  if (!Number.isInteger(token)) return sendError(res, 400, 'Invalid instrument token');
  const [stats, recent] = await Promise.all([getStockSetupStats(token), getStockSetupSignals(token, 30)]);
  sendOk(res, { stats, recent });
}));
