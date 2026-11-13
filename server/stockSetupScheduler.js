/**
 * Starts once the OI history job has finished, since both use the admin's Kite historical-data limit. The market
 * reference index (is_market_reference) is synced first.
 */

import {
  getMarketReference,
  getStockCandles,
  getWatchlistStocks,
} from './db.js';
import { istClock } from './marketClock.js';
import { OI_HISTORY_JOB, findWorkingAdminSession } from './oiHistoryScheduler.js';
import { scanStock, syncStockCandles } from './stockCandles.js';
import { createDailyKiteJob } from './dailyKiteJob.js';

export const STOCK_SETUPS_JOB = 'stock-setups-after-close';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Gap between Kite calls: Kite allows three historical requests a second. */
const KITE_GAP_MS = 400;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sync the market reference index's candles, so setups can check the market.
 * @returns {Promise<{ candles: unknown[], loginRefused: boolean }>} its candles (none without a reference)
 */
async function syncMarketReference(kite, results) {
  const reference = await getMarketReference();
  if (!reference) return { candles: [], loginRefused: false };
  try {
    await syncStockCandles(reference.instrumentToken, kite);
  } catch (err) {
    results.push({ tradingsymbol: reference.label, error: err.message });
    if (err.authFailure) return { candles: [], loginRefused: true };
  }
  return { candles: await getStockCandles(reference.instrumentToken), loginRefused: false };
}

async function scanWatchlist({ kite, results }) {
  const stocks = await getWatchlistStocks();
  console.log(`[Scheduler] ${STOCK_SETUPS_JOB}: syncing ${stocks.length} watchlist stock(s)`);

  const market = await syncMarketReference(kite, results);
  let loginRefused = market.loginRefused;
  for (const stock of loginRefused ? [] : stocks) {
    try {
      const sync = await syncStockCandles(stock.instrumentToken, kite);
      const analysis = await scanStock(stock, market.candles);
      results.push({ tradingsymbol: stock.tradingsymbol, fetched: sync.fetched, full: sync.full, setups: analysis?.setups.length ?? 0 });
      if (!sync.skipped) await pause(KITE_GAP_MS);
    } catch (err) {
      results.push({ tradingsymbol: stock.tradingsymbol, error: err.message });
      if (err.authFailure) {
        loginRefused = true;
        break;
      }
    }
  }
  const setups = results.reduce((sum, r) => sum + (r.setups || 0), 0);
  return { loginRefused, summary: `${stocks.length} stocks, ${setups} setup(s)` };
}

const runAfterCloseScan = createDailyKiteJob({
  job: STOCK_SETUPS_JOB,
  findSession: findWorkingAdminSession,
  dependsOn: OI_HISTORY_JOB,
  work: scanWatchlist,
});

export const stockSetupJob = {
  id: STOCK_SETUPS_JOB,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.afterClose(CHECK_INTERVAL_MS, () => runAfterCloseScan(istClock().date));
  },
};
