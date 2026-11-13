/** The after-close OI history job also scores each scrip right after fetching it (oiHistoryScheduler.js). */
import { evaluateTradeSetupSignalOutcomes } from './db.js';

export const SIGNAL_OUTCOMES_JOB_ID = 'signal-outcomes';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function scoreOpenSignals() {
  const count = await evaluateTradeSetupSignalOutcomes();
  if (count > 0) console.log(`[OI History] Updated ${count} signal outcome(s)`);
}

export const signalOutcomesJob = {
  id: SIGNAL_OUTCOMES_JOB_ID,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.repeat(CHECK_INTERVAL_MS, scoreOpenSignals);
  },
};
