/**
 * After-close stock scan.
 *
 * On weekdays from 15:45 IST, once the OI history job has finished (both use
 * the admin's Kite historical-data limit), bring every watchlist stock's daily
 * candles up to date, then re-scan each for setups and move open setups
 * forward. NIFTY 50 is synced first as the market reference.
 *
 * One run per IST date, recorded in scheduled_job_runs.
 */

import {
  claimScheduledJobRun,
  finishScheduledJobRun,
  getScheduledJobStatus,
  getStockCandles,
  getWatchlistStocks,
} from './db.js';
import { istClock, isAfterCloseOnWeekday } from './marketClock.js';
import { OI_HISTORY_JOB, findWorkingAdminSession } from './oiHistoryScheduler.js';
import { scanStock, syncStockCandles } from './stockCandles.js';
import { NIFTY_50_TOKEN } from '../shared/stockSetups.js';

export const STOCK_SETUPS_JOB = 'stock-setups-after-close';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Gap between Kite calls: Kite allows three historical requests a second. */
const KITE_GAP_MS = 400;

let running = false;
let lastDoneDate = null;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runAfterCloseScan(date) {
  if (lastDoneDate === date) return;
  if ((await getScheduledJobStatus(STOCK_SETUPS_JOB, date)) === 'done') {
    lastDoneDate = date;
    return;
  }
  const oiStatus = await getScheduledJobStatus(OI_HISTORY_JOB, date);
  if (oiStatus !== 'done' && oiStatus !== 'failed') return;

  const kite = await findWorkingAdminSession();
  if (!kite) return;
  if (!(await claimScheduledJobRun(STOCK_SETUPS_JOB, date))) return;

  const started = Date.now();
  const results = [];
  let authFailed = false;
  try {
    const stocks = await getWatchlistStocks();
    console.log(`[Scheduler] ${STOCK_SETUPS_JOB}: syncing ${stocks.length} watchlist stock(s)`);

    try {
      await syncStockCandles(NIFTY_50_TOKEN, kite);
    } catch (err) {
      results.push({ tradingsymbol: 'NIFTY 50', error: err.message });
      if (err.status === 401 || err.status === 403) authFailed = true;
    }
    const market = await getStockCandles(NIFTY_50_TOKEN);

    for (const stock of authFailed ? [] : stocks) {
      try {
        const sync = await syncStockCandles(stock.instrumentToken, kite);
        const analysis = await scanStock(stock, market);
        results.push({ tradingsymbol: stock.tradingsymbol, fetched: sync.fetched, full: sync.full, setups: analysis?.setups.length ?? 0 });
        if (!sync.skipped) await pause(KITE_GAP_MS);
      } catch (err) {
        results.push({ tradingsymbol: stock.tradingsymbol, error: err.message });
        if (err.status === 401 || err.status === 403) {
          authFailed = true;
          break;
        }
      }
    }

    const status = authFailed ? 'failed' : 'done';
    await finishScheduledJobRun(STOCK_SETUPS_JOB, date, status, { userId: kite.userId, results });
    if (status === 'done') lastDoneDate = date;
    const setups = results.reduce((sum, r) => sum + (r.setups || 0), 0);
    const errors = results.filter((r) => r.error).length;
    console.log(`[Scheduler] ${STOCK_SETUPS_JOB}: ${status} for ${date} — ${stocks.length} stocks, ${setups} setup(s), ${errors} error(s), ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.error(`[Scheduler] ${STOCK_SETUPS_JOB} failed:`, err.message);
    await finishScheduledJobRun(STOCK_SETUPS_JOB, date, 'failed', { error: err.message, results }).catch(() => {});
  }
}

/** Check now and every five minutes. Safe to call on every server instance. */
export function startStockSetupScheduler() {
  const tick = async () => {
    if (running || !isAfterCloseOnWeekday()) return;
    running = true;
    try {
      await runAfterCloseScan(istClock().date);
    } catch (err) {
      console.error(`[Scheduler] ${STOCK_SETUPS_JOB} check failed:`, err.message);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, CHECK_INTERVAL_MS).unref();
}
