/**
 * Nightly jobs.
 *
 * Every night from 22:00 IST, run each job file in server/jobs/nightly/ once,
 * in filename order. The runner doesn't know what a job does:
 *
 *   - `.sql` files run in one transaction.
 *   - `.js` files export `default async function run({ query, date, log })`;
 *     whatever object it returns is saved with the run.
 *
 * Files starting with `_` or `.` are skipped, so renaming a job pauses it.
 * The folder is read at each run, so a new or edited job takes effect the
 * same night without a restart.
 *
 * Each run is recorded in scheduled_job_runs as `nightly:<file>` for the IST
 * date, so a restart doesn't repeat a finished job and two servers can't run
 * the same job at once. A failed job is not retried until the next night,
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
  getScheduledJobStatus,
  query,
  runSqlScript,
} from './db.js';
import { istClock, isNightlyJobTime } from './marketClock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const NIGHTLY_JOBS_DIR = path.join(__dirname, 'jobs', 'nightly');
export const NIGHTLY_JOB_PREFIX = 'nightly:';
const CHECK_INTERVAL_MS = 60 * 1000;
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

/** Run one job file and return the detail to store with the run. */
async function runJobFile(file, date) {
  const fullPath = path.join(NIGHTLY_JOBS_DIR, file);

  if (file.endsWith('.sql')) {
    const rowCount = await runSqlScript(fs.readFileSync(fullPath, 'utf8'), SQL_TIMEOUT_MS);
    return { rowCount };
  }

  // The mtime in the URL makes an edited file load fresh instead of from the import cache.
  const url = `${pathToFileURL(fullPath).href}?v=${fs.statSync(fullPath).mtimeMs}`;
  const mod = await import(url);
  if (typeof mod.default !== 'function') {
    throw new Error('Job file must export a default async function');
  }
  const log = (...args) => console.log(`[Nightly] ${file}:`, ...args);
  const result = await mod.default({ query, date, log });
  return result && typeof result === 'object' ? result : {};
}

/** Run every job not yet run for `date`. Exported so a run can be triggered by hand. */
export async function runNightlyJobs(date) {
  for (const file of listJobFiles()) {
    const job = NIGHTLY_JOB_PREFIX + file;
    const status = await getScheduledJobStatus(job, date);
    if (status === 'done' || status === 'failed') continue;
    // Running elsewhere: checked again next tick, in case it goes stale.
    if (!(await claimScheduledJobRun(job, date))) continue;

    const started = Date.now();
    console.log(`[Nightly] ${file}: started for ${date}`);
    try {
      const detail = await runJobFile(file, date);
      const durationMs = Date.now() - started;
      await finishScheduledJobRun(job, date, 'done', { ...detail, durationMs });
      console.log(`[Nightly] ${file}: done in ${Math.round(durationMs / 1000)}s`, detail);
    } catch (err) {
      console.error(`[Nightly] ${file}: failed —`, err.message);
      await finishScheduledJobRun(job, date, 'failed', { error: err.message, durationMs: Date.now() - started })
        .catch(() => {});
    }
  }
}

/** Check now and every minute. Safe to call on every server instance. */
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
