/**
 * A Kite job that runs once per IST date: the after-close OI history fetch
 * (oiHistoryScheduler.js) and stock scan (stockSetupScheduler.js) share it.
 *
 * Each check (the job's plug-in calls it on the market clock) skips a date
 * already done (remembered in memory, and in scheduled_job_runs across
 * restarts and servers), waits until the job is ready and an admin Kite
 * session works (logging the wait once a day), claims the date's run so no
 * other server runs it too, does the job's work, and records the run:
 *   Done    the work finished; not run again that date
 *   Failed  Kite refused the login part-way, or the work threw; the next
 *           check runs it again
 * with the admin's user id and every result (an `error` on the ones that
 * failed) saved in the run's detail.
 */
import { claimScheduledJobRun, finishScheduledJobRun, getScheduledJobStatus } from './db.js';
import { JobRunStatus } from '../shared/appEnums.js';

/**
 * @typedef {{ apiKey: string, accessToken: string, userId: string }} AdminKite
 * @typedef {{ error?: string } & Record<string, unknown>} JobResult  one item's outcome, saved with the run
 * @typedef {{ loginRefused: boolean, summary: string }} JobOutcome  whether Kite refused the login, and what the work did for the log
 */

/** Whether Kite refused the session (401 / 403): the run stops and is tried again. */
export const isKiteLoginRefused = (/** @type {{ status?: number }} */ err) => err?.status === 401 || err?.status === 403;

/**
 * A check that runs `work` once per IST date.
 * @param {{
 *   job: string,
 *   findSession: () => Promise<AdminKite | null>,
 *   isReady?: (date: string) => Promise<boolean>,
 *   work: (run: { kite: AdminKite, date: string, results: JobResult[] }) => Promise<JobOutcome>,
 * }} options
 *   job          the job's name in scheduled_job_runs and the log
 *   findSession  the admin Kite session to use, or null while none works
 *   isReady      whether the job may run yet (e.g. after another job's run)
 *   work         the job itself; pushes each item's result to `results`
 * @returns {(date: string) => Promise<void>}
 */
export function createDailyKiteJob({ job, findSession, isReady = async () => true, work }) {
  /** @type {string | null} */
  let lastDoneDate = null;
  /** @type {string | null} */
  let lastWaitingLogDate = null;

  /** Log once a day that the job waits for an admin login. */
  function logWaiting(/** @type {string} */ date) {
    if (lastWaitingLogDate === date) return;
    console.log(`[Scheduler] ${job}: waiting for an admin Kite login today to run ${date}`);
    lastWaitingLogDate = date;
  }

  /** Record a run that threw; a failure to record it is logged, not thrown. */
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
    if (!(await isReady(date))) return;

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
