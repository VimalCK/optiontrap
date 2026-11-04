/**
 * Daily instrument sync.
 *
 * From 08:30 IST (INSTRUMENTS_REFRESH_MINUTES), once Zerodha has published the
 * day's list, sync the instruments table with the newest admin Kite session.
 * Checked at startup and every five minutes, so a server that was down at
 * 08:30 syncs as soon as it is back. Without an admin login yet it waits; a
 * user opening a screen before then syncs with their own session instead
 * (getOrFetchInstruments), and this job then finds the list current.
 */

import { getOrFetchInstruments, instrumentsAreFresh } from './instruments.js';
import { istClock } from './marketClock.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let lastWaitingLogDate = null;

async function tick() {
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

/** Check now and every five minutes. Safe to call on every server instance. */
export function startInstrumentSync() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error('[Instruments] Scheduled sync failed:', err.message);
    } finally {
      running = false;
    }
  };
  run();
  setInterval(run, CHECK_INTERVAL_MS).unref();
}
