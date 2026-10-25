/**
 * After-close OI history fetch.
 *
 * Every five minutes, on a weekday at or after 15:45 IST, fetch today's OI
 * history for every tracked scrip (stored data in the last 14 days), for the
 * current and later expiry months. Without this, a day nobody clicks Fetch is
 * lost for good once its contracts expire and drop out of Kite's instruments.
 *
 * Uses the newest admin Kite session from today's logins. If none is valid
 * yet, it keeps checking until midnight, so an evening login still saves the
 * day. One run per IST date, recorded in scheduled_job_runs.
 */

import {
  claimScheduledJobRun,
  evaluateTradeSetupSignalOutcomes,
  finishScheduledJobRun,
  getAdminKiteSessions,
  getRecentOiHistoryScrips,
  getScheduledJobStatus,
  getStoredOiHistoryExpiryMonths,
} from './db.js';
import { daysBefore, istClock, isAfterCloseOnWeekday } from './marketClock.js';
import { fetchOiHistoryMonth } from './oiHistoryFetch.js';

export const OI_HISTORY_JOB = 'oi-history-after-close';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TRACKED_SCRIP_DAYS = 14;

let running = false;
let lastDoneDate = null;
let lastWaitingLogDate = null;

/** The newest admin session whose Kite token still works, or null. */
async function findWorkingAdminSession() {
  const sessions = await getAdminKiteSessions();
  for (const kite of sessions.slice(0, 3)) {
    try {
      const res = await fetch('https://api.kite.trade/user/profile', {
        headers: { Authorization: `token ${kite.apiKey}:${kite.accessToken}`, 'X-Kite-Version': '3' },
      });
      if (res.ok) return kite;
    } catch {
      // Network error: try the next session.
    }
  }
  return null;
}

/** Expiry months to fetch for a scrip: the current month plus any later stored months. */
async function monthsToFetch(scrip, currentMonth) {
  const stored = await getStoredOiHistoryExpiryMonths(scrip);
  return [...new Set([currentMonth, ...stored.filter((month) => month >= currentMonth)])].sort();
}

async function runAfterCloseFetch(date) {
  if (lastDoneDate === date) return;
  if ((await getScheduledJobStatus(OI_HISTORY_JOB, date)) === 'done') {
    lastDoneDate = date;
    return;
  }

  const kite = await findWorkingAdminSession();
  if (!kite) {
    if (lastWaitingLogDate !== date) {
      console.log(`[Scheduler] ${OI_HISTORY_JOB}: waiting for an admin Kite login today to fetch ${date}`);
      lastWaitingLogDate = date;
    }
    return;
  }
  if (!(await claimScheduledJobRun(OI_HISTORY_JOB, date))) return;

  const started = Date.now();
  const results = [];
  let authFailed = false;
  try {
    const scrips = await getRecentOiHistoryScrips(daysBefore(date, TRACKED_SCRIP_DAYS));
    console.log(`[Scheduler] ${OI_HISTORY_JOB}: fetching ${date} for ${scrips.join(', ') || 'no tracked scrips'}`);

    for (const scrip of scrips) {
      for (const expiryMonth of await monthsToFetch(scrip, date.slice(0, 7))) {
        try {
          const summary = await fetchOiHistoryMonth({
            scrip, expiryMonth, apiKey: kite.apiKey, accessToken: kite.accessToken,
          });
          results.push({ scrip, expiryMonth, rowCount: summary.rowCount, fetchedDays: summary.fetchedDays });
        } catch (err) {
          results.push({ scrip, expiryMonth, error: err.message });
          if (err.status === 401 || err.status === 403) {
            authFailed = true;
            break;
          }
        }
      }
      if (authFailed) break;

      try {
        await evaluateTradeSetupSignalOutcomes(scrip);
      } catch (err) {
        console.warn(`[Scheduler] Signal outcome evaluation failed for ${scrip}:`, err.message);
      }
    }

    const status = authFailed ? 'failed' : 'done';
    await finishScheduledJobRun(OI_HISTORY_JOB, date, status, { userId: kite.userId, results });
    if (status === 'done') lastDoneDate = date;
    const rowCount = results.reduce((sum, r) => sum + (r.rowCount || 0), 0);
    const errors = results.filter((r) => r.error).length;
    console.log(`[Scheduler] ${OI_HISTORY_JOB}: ${status} for ${date} — ${rowCount} rows, ${errors} error(s), ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.error(`[Scheduler] ${OI_HISTORY_JOB} failed:`, err.message);
    await finishScheduledJobRun(OI_HISTORY_JOB, date, 'failed', { error: err.message, results }).catch(() => {});
  }
}

/** Check now and every five minutes. Safe to call on every server instance. */
export function startOiHistoryScheduler() {
  const tick = async () => {
    if (running || !isAfterCloseOnWeekday()) return;
    running = true;
    try {
      await runAfterCloseFetch(istClock().date);
    } catch (err) {
      console.error(`[Scheduler] ${OI_HISTORY_JOB} check failed:`, err.message);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, CHECK_INTERVAL_MS).unref();
}
