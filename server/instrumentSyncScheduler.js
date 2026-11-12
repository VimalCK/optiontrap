/**
 * Daily instrument sync, a scheduled job (server/scheduledJobs.js).
 *
 * From 08:30 IST (INSTRUMENTS_REFRESH_MINUTES), once Zerodha has published the
 * day's list, sync the instruments table with the newest admin Kite session.
 * Checked every five minutes until midnight, and at once when the server
 * starts later in the day, so a server that was down at 08:30 syncs as soon
 * as it is back. Without an admin login yet it waits; a user opening a screen
 * before then syncs with their own session instead (getOrFetchInstruments),
 * and this job then finds the list current.
 */

import { getOrFetchInstruments, instrumentsAreFresh } from './instruments.js';
import { INSTRUMENTS_REFRESH_MINUTES, istClock } from './marketClock.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';

export const INSTRUMENT_SYNC_JOB_ID = 'instrument-sync';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let lastWaitingLogDate = null;

/** Sync the instrument list with the admin session if it is out of date. */
async function syncIfStale() {
  if (await instrumentsAreFresh()) return;

  const kite = await findWorkingAdminSession();
  if (!kite) {
    const { date } = istClock();
    if (lastWaitingLogDate !== date) {
      console.log('[Instruments] Waiting for an admin Kite login to sync the instrument list');
      lastWaitingLogDate = date;
    }
    return;
  }
  await getOrFetchInstruments(kite.apiKey, kite.accessToken);
}

/** The instrument sync plug-in: every five minutes from 08:30 IST. */
export const instrumentSyncJob = {
  id: INSTRUMENT_SYNC_JOB_ID,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.daily(INSTRUMENTS_REFRESH_MINUTES, CHECK_INTERVAL_MS, syncIfStale);
  },
};
