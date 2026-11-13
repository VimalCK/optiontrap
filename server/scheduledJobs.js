/**
 * Background data jobs on their own plug-in host, apart from the trade engine, so the jobs and the engine never wait
 * on each other. Each job says when it runs through ctx.market, so "08:30 IST" and "after the close" are decided in
 * one place (server/tradeEngine/market.js). Adding a job means adding it to JOBS.
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

const JOBS = [signalOutcomesJob, instrumentSyncJob, oiSnapshotJob, oiHistoryJob, stockSetupJob, nightlyJobsJob];

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
