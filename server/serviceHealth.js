/**
 * Health checks for the background services, in the shape of the IETF
 * "Health Check Response Format for HTTP APIs" (draft-inadarei-api-health-check):
 * each check is { status: 'pass' | 'warn' | 'fail', output, time }, where
 * output says why in plain English and time (ISO) is when the check's
 * observation was made (null when there is none yet).
 *
 * Each check is a pure function of the service's status() snapshot
 * (autoTradeEngine.js, autoTradeMonitor.js), served by GET /api/admin/health
 * and shown on the admin Services page.
 */

/**
 * @typedef {'pass' | 'warn' | 'fail'} HealthStatus
 * @typedef {{ status: HealthStatus, output: string, time: string | null }} HealthCheck
 */

const iso = (/** @type {number | null} */ ms) => (ms === null ? null : new Date(ms).toISOString());
const count = (/** @type {number} */ n, /** @type {string} */ noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The trade engine: passes when its last run worked, warns when some
 * signals failed, fails when the run itself failed.
 * @param {{ lastRun: import('./autoTradeEngine.js').LastRun | null }} status
 * @returns {HealthCheck}
 */
export function tradeEngineHealth({ lastRun }) {
  if (!lastRun) return { status: 'pass', output: 'No run yet · runs after each OI snapshot in market hours', time: null };
  const time = iso(lastRun.at);
  if (lastRun.error !== null) return { status: 'fail', output: `Last run failed · ${lastRun.error}`, time };
  const summary = `Last run · ${count(lastRun.users, 'user')} · ${count(lastRun.signals, 'signal')}`;
  if (lastRun.failed > 0) return { status: 'warn', output: `${summary} · ${lastRun.failed} failed`, time };
  return { status: 'pass', output: summary, time };
}

/**
 * The trade monitor: fails when its market check failed, or when open
 * automated positions go unwatched for want of an admin Kite login.
 * @param {ReturnType<ReturnType<typeof import('./autoTradeMonitor.js').createAutoTradeMonitor>['status']>} status
 * @returns {HealthCheck}
 */
export function tradeMonitorHealth(status) {
  const checkedAt = iso(status.lastCheckAt);
  if (status.lastCheckAt === null) return { status: 'pass', output: 'Starting · no market check yet', time: null };
  if (status.lastError !== null) return { status: 'fail', output: `Market check failed · ${status.lastError}`, time: checkedAt };
  if (!status.marketOpen) return { status: 'pass', output: 'Market closed · watches automated positions in market hours', time: checkedAt };
  if (status.waitingForLogin) {
    return { status: 'fail', output: `${count(status.watchedPositions, 'open position')} unwatched · no admin Kite login`, time: checkedAt };
  }
  if (!status.feedConnected) return { status: 'pass', output: 'No open automated positions', time: checkedAt };
  const watching = `Watching ${count(status.watchedPositions, 'position')} in ${count(status.watchedInstruments, 'instrument')}`;
  if (status.lastTickAt === null) return { status: 'pass', output: `${watching} · no tick yet`, time: checkedAt };
  return { status: 'pass', output: `${watching} · last tick`, time: iso(status.lastTickAt) };
}

/** A YYYY-MM-DD date as "11 Nov". */
const dayLabel = (/** @type {string} */ date) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/**
 * The nightly jobs (nightlyJobs.js, from 08:30 IST) for the latest due date:
 * fails when a job failed, warns when some haven't run, passes when all are
 * done or still running.
 * @param {Awaited<ReturnType<typeof import('./nightlyJobs.js').nightlyJobsStatus>>} status
 * @returns {HealthCheck}
 */
export function nightlyJobsHealth({ date, jobs }) {
  const day = dayLabel(date);
  if (jobs.length === 0) return { status: 'pass', output: 'No nightly jobs', time: null };
  const of = (/** @type {number} */ n) => `${n} of ${jobs.length}`;
  const failed = jobs.filter((job) => job.status === 'failed');
  if (failed.length > 0) {
    return { status: 'fail', output: `${of(failed.length)} failed for ${day} · ${failed[0].file}: ${failed[0].error ?? 'no error saved'}`, time: null };
  }
  const done = jobs.filter((job) => job.status === 'done').length;
  if (done === jobs.length) return { status: 'pass', output: `All ${count(jobs.length, 'job')} done for ${day}`, time: null };
  if (jobs.some((job) => job.status === 'running')) return { status: 'pass', output: `Running for ${day} · ${of(done)} done`, time: null };
  return { status: 'warn', output: `${of(jobs.length - done)} not run for ${day}`, time: null };
}

/** A check whose status couldn't be read (e.g. the database is down). */
export function unreadableHealth(/** @type {string} */ what, /** @type {unknown} */ err) {
  const reason = err instanceof Error ? err.message : String(err);
  return /** @type {HealthCheck} */ ({ status: 'fail', output: `Couldn't read the ${what} · ${reason}`, time: null });
}
