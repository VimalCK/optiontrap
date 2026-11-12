/**
 * Nightly jobs.
 *
 * Every day from 08:30 IST, run each job file in server/jobs/nightly/ once,
 * in filename order. If the server was down at 08:30, they run as soon as it
 * starts again that day. The runner doesn't know what a job does:
 *
 *   - `.sql` files run in one transaction.
 *   - `.js` files export `default async function run({ query, runSql, date, log })`;
 *     whatever object it returns is saved with the run. `runSql` runs SQL the
 *     way a `.sql` file runs, for jobs that build their SQL (enum values
 *     through sqlEnum, server/sql.js).
 *
 * Files starting with `_` or `.` are skipped, so renaming a job pauses it.
 * The folder is read at each run, so a new or edited job takes effect the
 * same night without a restart.
 *
 * Each run is recorded in scheduled_job_runs as `nightly:<file>` for the IST
 * date, so a restart doesn't repeat a finished job and two servers can't run
 * the same job at once. A failed job is not retried until the next day,
 * since it may have half-done something (like sending some of its emails).
 * Jobs should still be safe to run twice: a crash mid-run is retried once the
 * run has been stale for two hours.
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
import { istClock, isNightlyJobTime } from './marketClock.js';
import { addDays } from '../shared/marketTime.js';
import { JobRunStatus } from '../shared/appEnums.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const NIGHTLY_JOBS_DIR = path.join(__dirname, 'jobs', 'nightly');
export const NIGHTLY_JOB_PREFIX = 'nightly:';
/** Checked at startup, then hourly: the 08:30-midnight window always contains a check. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SQL_TIMEOUT_MS = 10 * 60 * 1000;

let running = false;

/** Job files to run, in order: `.sql` and `.js` files not starting with `_` or `.`. */
export function selectJobFiles(names) {
  return names
    .filter((name) => /\.(sql|js)$/.test(name) && !/^[_.]/.test(name) && !name.endsWith('.test.js'))
    .sort();
}

function listJobFiles() {
  if (!fs.existsSync(NIGHTLY_JOBS_DIR)) return [];
  return selectJobFiles(fs.readdirSync(NIGHTLY_JOBS_DIR));
}

/** Run SQL in one transaction, in market time, with the job timeout; returns the rows affected. */
const runSql = (sql) => runSqlScript(sql, SQL_TIMEOUT_MS);

/** Run one job file and return the detail to store with the run. */
async function runJobFile(file, date) {
  const fullPath = path.join(NIGHTLY_JOBS_DIR, file);

  if (file.endsWith('.sql')) {
    const rowCount = await runSql(fs.readFileSync(fullPath, 'utf8'));
    return { rowCount };
  }

  // The mtime in the URL makes an edited file load fresh instead of from the import cache.
  const url = `${pathToFileURL(fullPath).href}?v=${fs.statSync(fullPath).mtimeMs}`;
  const mod = await import(url);
  if (typeof mod.default !== 'function') {
    throw new Error('Job file must export a default async function');
  }
  const log = (...args) => console.log(`[Nightly] ${file}:`, ...args);
  const result = await mod.default({ query, runSql, date, log });
  return result && typeof result === 'object' ? result : {};
}

/** Run every job not yet run for `date`. Exported so a run can be triggered by hand. */
export async function runNightlyJobs(date) {
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

/** The date of the latest nightly run that is due: today from 08:30 IST, yesterday before that. */
export function latestNightlyDate(now = new Date()) {
  const { date } = istClock(now);
  return isNightlyJobTime(now) ? date : addDays(date, -1);
}

/**
 * Each current job file's run for the latest due date (status null when it
 * hasn't run, and the error a failed run saved), for the admin health page.
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

/** Check now and every hour. Safe to call on every server instance. */
export function startNightlyJobs() {
  const tick = async () => {
    if (running || !isNightlyJobTime()) return;
    running = true;
    try {
      await runNightlyJobs(istClock().date);
    } catch (err) {
      console.error('[Nightly] check failed:', err.message);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, CHECK_INTERVAL_MS).unref();
}
