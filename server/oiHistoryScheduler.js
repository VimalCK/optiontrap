/**
 * After-close OI history fetch, a scheduled job (server/scheduledJobs.js).
 *
 * Every five minutes, on a weekday at or after 15:45 IST, fetch today's OI
 * history for every tracked scrip (stored data in the last 14 days), for the
 * current and later expiry months. Without this, a day nobody clicks Fetch is
 * lost for good once its contracts expire and drop out of Kite's instruments.
 *
 * Uses the newest admin Kite session from today's logins. If none is valid
 * yet, it keeps checking until midnight, so an evening login still saves the
 * day. One run per IST date, recorded in scheduled_job_runs (dailyKiteJob.js).
 */

import {
  evaluateTradeSetupSignalOutcomes,
  getAdminKiteSessions,
  getRecentOiHistoryScrips,
  getStoredOiHistoryExpiryMonths,
} from './db.js';
import { daysBefore, istClock } from './marketClock.js';
import { fetchOiHistoryMonth } from './oiHistoryFetch.js';
import { createDailyKiteJob } from './dailyKiteJob.js';
import { kiteClient } from './kiteClient.js';

export const OI_HISTORY_JOB = 'oi-history-after-close';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TRACKED_SCRIP_DAYS = 14;

/** The newest admin session whose Kite token still works, or null. */
export async function findWorkingAdminSession() {
  const sessions = await getAdminKiteSessions();
  for (const kite of sessions.slice(0, 3)) {
    try {
      await kiteClient(kite).get('/user/profile');
      return kite;
    } catch {
      // Refused or unreachable: try the next session.
    }
  }
  return null;
}

/** Expiry months to fetch for a scrip: the current month plus any later stored months. */
async function monthsToFetch(scrip, currentMonth) {
  const stored = await getStoredOiHistoryExpiryMonths(scrip);
  return [...new Set([currentMonth, ...stored.filter((month) => month >= currentMonth)])].sort();
}

/**
 * Fetch one scrip's months; stops at a refused login.
 * @returns {Promise<boolean>} whether Kite refused the login
 */
async function fetchScrip(scrip, date, kite, results) {
  for (const expiryMonth of await monthsToFetch(scrip, date.slice(0, 7))) {
    try {
      const summary = await fetchOiHistoryMonth({
        scrip, expiryMonth, apiKey: kite.apiKey, accessToken: kite.accessToken,
      });
      results.push({ scrip, expiryMonth, rowCount: summary.rowCount, fetchedDays: summary.fetchedDays });
    } catch (err) {
      results.push({ scrip, expiryMonth, error: err.message });
      if (err.authFailure) return true;
    }
  }
  return false;
}

/** Re-score a scrip's open trade setup signals with the prices just fetched. */
async function scoreSignals(scrip) {
  try {
    await evaluateTradeSetupSignalOutcomes(scrip);
  } catch (err) {
    console.warn(`[Scheduler] Signal outcome evaluation failed for ${scrip}:`, err.message);
  }
}

/** Fetch every tracked scrip for `date`, scoring each one's signals after it. */
async function fetchTrackedScrips({ kite, date, results }) {
  const scrips = await getRecentOiHistoryScrips(daysBefore(date, TRACKED_SCRIP_DAYS));
  console.log(`[Scheduler] ${OI_HISTORY_JOB}: fetching ${date} for ${scrips.join(', ') || 'no tracked scrips'}`);

  let loginRefused = false;
  for (const scrip of scrips) {
    loginRefused = await fetchScrip(scrip, date, kite, results);
    if (loginRefused) break;
    await scoreSignals(scrip);
  }
  const rowCount = results.reduce((sum, r) => sum + (r.rowCount || 0), 0);
  return { loginRefused, summary: `${rowCount} rows` };
}

const runAfterCloseFetch = createDailyKiteJob({
  job: OI_HISTORY_JOB,
  findSession: findWorkingAdminSession,
  work: fetchTrackedScrips,
});

/** The OI history plug-in: checks every five minutes after the close until today's run is done. */
export const oiHistoryJob = {
  id: OI_HISTORY_JOB,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.afterClose(CHECK_INTERVAL_MS, () => runAfterCloseFetch(istClock().date));
  },
};
