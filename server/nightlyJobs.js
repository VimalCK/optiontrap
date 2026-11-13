/**
 * Every day from 08:30 IST, each job file in server/jobs/nightly/ runs once, in filename order.
 *   - `.sql` files run in one transaction.
 *   - `.js` files export `default async function run({ query, runSql, date, log })`; whatever object it returns is
 *     saved with the run. `runSql` runs SQL the way a `.sql` file runs, for jobs that build their SQL (sqlEnum).
 *
 * Files starting with `_` or `.` are skipped, so renaming a job pauses it. The folder is read at each run.
 *
 * Each run is recorded in scheduled_job_runs as `nightly:<file>` for the IST date. A failed job is not retried until
 * the next day, since it may have half-done something (like sending some of its emails). Jobs should still be safe
 * to run twice: a crash mid-run is retried once the run has been stale for two hours.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  claimScheduledJobRun,
  finishScheduledJobRun,
  getScheduledJobRunsOn,
  getScheduledJobStatus,
  query,
  runSqlScript,
} from './db.js';
import { NIGHTLY_JOBS_MINUTES, istClock, isNightlyJobTime } from './marketClock.js';
import { addDays } from '../shared/marketTime.js';
import { JobRunStatus } from '../shared/appEnums.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NIGHTLY_JOBS_DIR = path.join(__dirname, 'jobs', 'nightly');
export const NIGHTLY_JOB_PREFIX = 'nightly:';
export const NIGHTLY_JOBS_ID = 'nightly-jobs';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SQL_TIMEOUT_MS = 10 * 60 * 1000;

export function selectJobFiles(names) {
  return names
    .filter((name) => /\.(sql|js)$/.test(name) && !/^[_.]/.test(name) && !name.endsWith('.test.js'))
    .sort();
}

function listJobFiles() {
  if (!fs.existsSync(NIGHTLY_JOBS_DIR)) return [];
  return selectJobFiles(fs.readdirSync(NIGHTLY_JOBS_DIR));
}

const runSql = (sql) => runSqlScript(sql, SQL_TIMEOUT_MS);

async function runJobFile(file, date) {
  const fullPath = path.join(NIGHTLY_JOBS_DIR, file);

  if (file.endsWith('.sql')) {
    const rowCount = await runSql(fs.readFileSync(fullPath, 'utf8'));
    return { rowCount };
  }

  // The mtime in the URL makes an edited file load fresh, not from the import cache.
  const url = `${pathToFileURL(fullPath).href}?v=${fs.statSync(fullPath).mtimeMs}`;
  const mod = await import(url);
  if (typeof mod.default !== 'function') {
    throw new Error('Job file must export a default async function');
  }
  const log = (...args) => console.log(`[Nightly] ${file}:`, ...args);
  const result = await mod.default({ query, runSql, date, log });
  return result && typeof result === 'object' ? result : {};
}

/** Exported so a run can be triggered by hand. */
async function runNightlyJobs(date) {
  for (const file of listJobFiles()) {
    const job = NIGHTLY_JOB_PREFIX + file;
    const status = await getScheduledJobStatus(job, date);
    if (status === JobRunStatus.Done || status === JobRunStatus.Failed) continue;
    // Running elsewhere: checked again next tick, in case it goes stale.
    if (!(await claimScheduledJobRun(job, date))) continue;

    const started = Date.now();
    console.log(`[Nightly] ${file}: started for ${date}`);
    try {
      const detail = await runJobFile(file, date);
      const durationMs = Date.now() - started;
      await finishScheduledJobRun(job, date, JobRunStatus.Done, { ...detail, durationMs });
      console.log(`[Nightly] ${file}: done in ${Math.round(durationMs / 1000)}s`, detail);
    } catch (err) {
      console.error(`[Nightly] ${file}: failed —`, err.message);
      await finishScheduledJobRun(job, date, JobRunStatus.Failed, { error: err.message, durationMs: Date.now() - started })
        .catch(() => {});
    }
  }
}

export function latestNightlyDate(now = new Date()) {
  const { date } = istClock(now);
  return isNightlyJobTime(now) ? date : addDays(date, -1);
}

/**
 * Status is null when the job hasn't run.
 * @returns {Promise<{ date: string, jobs: { file: string, status: string | null, error: string | null }[] }>}
 */
export async function nightlyJobsStatus(now = new Date()) {
  const date = latestNightlyDate(now);
  const files = listJobFiles();
  if (files.length === 0) return { date, jobs: [] };
  const runs = await getScheduledJobRunsOn(files.map((file) => NIGHTLY_JOB_PREFIX + file), date);
  const byJob = new Map(runs.map((run) => [run.job, run]));
  return {
    date,
    jobs: files.map((file) => {
      const run = byJob.get(NIGHTLY_JOB_PREFIX + file);
      return { file, status: run?.status ?? null, error: run?.detail?.error ?? null };
    }),
  };
}

export const nightlyJobsJob = {
  id: NIGHTLY_JOBS_ID,
  /** @param {import('./tradeEngine/host.js').PluginContext} ctx */
  start(ctx) {
    ctx.market.daily(NIGHTLY_JOBS_MINUTES, CHECK_INTERVAL_MS, () => runNightlyJobs(istClock().date));
  },
};
