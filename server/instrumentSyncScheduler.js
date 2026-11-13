/**
 * Zerodha publishes the day's instrument list at 08:30 IST, so the sync starts then. A server that was down at 08:30
 * syncs once it is back. Without an admin login it waits; a user's own session can sync the list first
 * (getOrFetchInstruments), and this job then finds it current.
 */

import { getOrFetchInstruments, instrumentsAreFresh } from './instruments.js';
import { INSTRUMENTS_REFRESH_MINUTES, istClock } from './marketClock.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';

export const INSTRUMENT_SYNC_JOB_ID = 'instrument-sync';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let lastWaitingLogDate = null;

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

export const instrumentSyncJob = {
  id: INSTRUMENT_SYNC_JOB_ID,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.daily(INSTRUMENTS_REFRESH_MINUTES, CHECK_INTERVAL_MS, syncIfStale);
  },
};
