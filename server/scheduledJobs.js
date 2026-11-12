/**
 * The server's scheduled jobs: background data work that runs on the market
 * clock instead of its own timer. Each job is a plug-in ({ id, start(ctx) })
 * on its own plug-in host (server/tradeEngine/host.js), apart from the trade
 * engine: a separate advisory lock, so one copy runs across servers and the
 * jobs and the engine never wait on each other. Each job says when it runs
 * through ctx.market (every, daily, afterClose, repeat), so "08:30 IST" and
 * "after the close" are decided in one place (server/tradeEngine/market.js).
 * A job that throws is logged under its id; the others keep running.
 *
 * Adding a job means adding it to JOBS; the host knows none of them by name.
 */
import { createPluginHost } from './tradeEngine/host.js';
import { signalOutcomesJob } from './signalOutcomesJob.js';
import { instrumentSyncJob } from './instrumentSyncScheduler.js';
import { oiSnapshotJob } from './oiSnapshotScheduler.js';
import { oiHistoryJob } from './oiHistoryScheduler.js';
import { stockSetupJob } from './stockSetupScheduler.js';
import { nightlyJobsJob } from './nightlyJobs.js';
import { PluginKind } from '../shared/appEnums.js';

const JOBS_LOCK = 'scheduled-jobs';

/**
 * The jobs, each with its schedule:
 *   signal outcomes  at startup and hourly
 *   instrument sync  from 08:30 IST until the day's list is stored
 *   OI snapshots     every 10 minutes in market hours
 *   OI history       after the close, until today's run is done
 *   stock setups     after the close, once the OI history run has finished
 *   nightly jobs     from 08:30 IST, each job file once a day
 */
const JOBS = [signalOutcomesJob, instrumentSyncJob, oiSnapshotJob, oiHistoryJob, stockSetupJob, nightlyJobsJob];

/** A job host's log line in the server console: `[Jobs] <plug-in> · <event>` and its details. */
const jobLogger = (/** @type {string} */ name) => (/** @type {string} */ event, /** @type {Record<string, unknown>} */ details = {}) => {
  const detail = Object.entries(details).map(([key, value]) => `${key}=${value}`).join(' ');
  console.log(`[Jobs] ${name} · ${event}${detail ? ` · ${detail}` : ''}`);
};

export const scheduledJobs = createPluginHost({
  name: 'Jobs',
  lockName: JOBS_LOCK,
  groups: [{ kind: PluginKind.Job, plugins: JOBS }],
  logFor: jobLogger,
});
