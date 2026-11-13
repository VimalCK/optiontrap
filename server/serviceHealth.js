/**
 * Health checks in the shape of the IETF "Health Check Response Format for HTTP APIs": { status, output, time }.
 * Each check is a pure function of a status() snapshot. The engine's check folds its plug-ins' own health and knows
 * no plug-in by name, the same rule the host follows.
 */
import { HealthStatus, JobRunStatus, PluginState } from '../shared/appEnums.js';

/**
 * @typedef {{ status: import('../shared/appEnums.js').HealthStatusId, output: string, time: string | null }} HealthCheck
 * @typedef {ReturnType<ReturnType<typeof import('./tradeEngine/host.js').createTradeEngine>['status']>} EngineStatus
 */

/** An epoch-ms time as a check's ISO time; null stays null. */
export const healthTime = (/** @type {number | null} */ ms) => (ms === null ? null : new Date(ms).toISOString());

/** "1 user", "2 users": a count with its noun, for a check's output. */
export const countLabel = (/** @type {number} */ n, /** @type {string} */ noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What the engine says when every plug-in passes but none reports its own health. */
const ALL_RUNNING = 'All plug-ins running';

/**
 * The trade engine, the one check Admin Services shows for trading, folded
 * from its plug-ins: warns while it stands by (another server holds it),
 * fails when a plug-in couldn't start, then reports the first plug-in health
 * that fails, a plug-in handler that failed, or the first health that warns.
 * When all pass it joins the plug-ins' own outputs, in the engine's order,
 * timed at the first one that has a time.
 * @param {EngineStatus} engine
 * @returns {HealthCheck}
 */
export function tradeEngineHealth({ running, plugins }) {
  if (!running) return { status: HealthStatus.Warn, output: 'Standing by · not holding the engine lock', time: null };
  const notStarted = plugins.find((plugin) => plugin.state === PluginState.Failed);
  if (notStarted) return { status: HealthStatus.Fail, output: `${notStarted.id} could not start · ${notStarted.error}`, time: null };
  const checks = plugins.flatMap((plugin) => (plugin.health ? [plugin.health] : []));
  const failing = checks.find((check) => check.status === HealthStatus.Fail);
  if (failing) return failing;
  const erred = plugins.find((plugin) => plugin.error !== null);
  if (erred) return { status: HealthStatus.Warn, output: `${erred.id} failed · ${erred.error}`, time: null };
  const warning = checks.find((check) => check.status === HealthStatus.Warn);
  if (warning) return warning;
  const output = checks.map((check) => check.output).join(' · ') || ALL_RUNNING;
  return { status: HealthStatus.Pass, output, time: checks.find((check) => check.time !== null)?.time ?? null };
}

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
  if (jobs.length === 0) return { status: HealthStatus.Pass, output: 'No nightly jobs', time: null };
  const of = (/** @type {number} */ n) => `${n} of ${jobs.length}`;
  const failed = jobs.filter((job) => job.status === JobRunStatus.Failed);
  if (failed.length > 0) {
    return { status: HealthStatus.Fail, output: `${of(failed.length)} failed for ${day} · ${failed[0].file}: ${failed[0].error ?? 'no error saved'}`, time: null };
  }
  const done = jobs.filter((job) => job.status === JobRunStatus.Done).length;
  if (done === jobs.length) return { status: HealthStatus.Pass, output: `All ${countLabel(jobs.length, 'job')} done for ${day}`, time: null };
  if (jobs.some((job) => job.status === JobRunStatus.Running)) return { status: HealthStatus.Pass, output: `Running for ${day} · ${of(done)} done`, time: null };
  return { status: HealthStatus.Warn, output: `${of(jobs.length - done)} not run for ${day}`, time: null };
}

/** A check whose status couldn't be read (e.g. the database is down). */
export function unreadableHealth(/** @type {string} */ what, /** @type {unknown} */ err) {
  const reason = err instanceof Error ? err.message : String(err);
  return /** @type {HealthCheck} */ ({ status: HealthStatus.Fail, output: `Couldn't read the ${what} · ${reason}`, time: null });
}
