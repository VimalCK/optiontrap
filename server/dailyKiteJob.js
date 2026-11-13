/**
 * A Kite job that runs once per IST date. A run is claimed in scheduled_job_runs so no other server runs it too.
 *   Done    the work finished; not run again that date
 *   Failed  Kite refused the login part-way, or the work threw; the next check runs it again
 */
import { claimScheduledJobRun, finishScheduledJobRun, getScheduledJobStatus } from './db.js';
import { JobRunStatus } from '../shared/appEnums.js';

/**
 * @typedef {{ apiKey: string, accessToken: string, userId: string }} AdminKite
 * @typedef {{ error?: string } & Record<string, unknown>} JobResult  one item's outcome, saved with the run
 * @typedef {{ loginRefused: boolean, summary: string }} JobOutcome  whether Kite refused the login, and what the work did for the log
 */

/**
 * @param {{
 *   job: string,
 *   findSession: () => Promise<AdminKite | null>,
 *   dependsOn?: string,
 *   work: (run: { kite: AdminKite, date: string, results: JobResult[] }) => Promise<JobOutcome>,
 * }} options
 *   dependsOn    a job whose run for the date must finish first (both use Kite's historical-data limit)
 * @returns {(date: string) => Promise<void>}
 */
export function createDailyKiteJob({ job, findSession, dependsOn, work }) {
  /** @type {string | null} */
  let lastDoneDate = null;
  /** @type {string | null} */
  let lastWaitingLogDate = null;

  function logWaiting(/** @type {string} */ date) {
    if (lastWaitingLogDate === date) return;
    console.log(`[Scheduler] ${job}: waiting for an admin Kite login today to run ${date}`);
    lastWaitingLogDate = date;
  }

  async function dependencyFinished(/** @type {string} */ date) {
    if (!dependsOn) return true;
    const status = await getScheduledJobStatus(dependsOn, date);
    return status === JobRunStatus.Done || status === JobRunStatus.Failed;
  }

  async function recordFailure(/** @type {string} */ date, /** @type {Error} */ err, /** @type {JobResult[]} */ results) {
    console.error(`[Scheduler] ${job} failed:`, err.message);
    try {
      await finishScheduledJobRun(job, date, JobRunStatus.Failed, { error: err.message, results });
    } catch (recordErr) {
      console.error(`[Scheduler] ${job}: could not record the failed run:`, /** @type {Error} */ (recordErr).message);
    }
  }

  return async function runForDate(date) {
    if (lastDoneDate === date) return;
    if ((await getScheduledJobStatus(job, date)) === JobRunStatus.Done) {
      lastDoneDate = date;
      return;
    }
    if (!(await dependencyFinished(date))) return;

    const kite = await findSession();
    if (!kite) {
      logWaiting(date);
      return;
    }
    if (!(await claimScheduledJobRun(job, date))) return;

    const started = Date.now();
    /** @type {JobResult[]} */
    const results = [];
    try {
      const { loginRefused, summary } = await work({ kite, date, results });
      const status = loginRefused ? JobRunStatus.Failed : JobRunStatus.Done;
      await finishScheduledJobRun(job, date, status, { userId: kite.userId, results });
      if (status === JobRunStatus.Done) lastDoneDate = date;
      const errors = results.filter((result) => result.error).length;
      console.log(`[Scheduler] ${job}: ${status} for ${date} — ${summary}, ${errors} error(s), ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      await recordFailure(date, /** @type {Error} */ (err), results);
    }
  };
}
