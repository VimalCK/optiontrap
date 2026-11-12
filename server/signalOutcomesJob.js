/**
 * Signal outcomes, a scheduled job (server/scheduledJobs.js): score the open
 * trade setup signals (saved from the OI History tab) from stored OI history
 * prices at startup and every hour, so outcomes don't depend on someone
 * opening that strike in the browser. The after-close OI history job also
 * scores each scrip right after fetching it (oiHistoryScheduler.js).
 */
import { evaluateTradeSetupSignalOutcomes } from './db.js';

export const SIGNAL_OUTCOMES_JOB_ID = 'signal-outcomes';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Score every open signal; logs how many changed. */
async function scoreOpenSignals() {
  const count = await evaluateTradeSetupSignalOutcomes();
  if (count > 0) console.log(`[OI History] Updated ${count} signal outcome(s)`);
}

/** The signal outcomes plug-in: at startup, then every hour. */
export const signalOutcomesJob = {
  id: SIGNAL_OUTCOMES_JOB_ID,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.repeat(CHECK_INTERVAL_MS, scoreOpenSignals);
  },
};
