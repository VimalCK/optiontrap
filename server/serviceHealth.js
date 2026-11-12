/**
 * Health checks for the background services, in the shape of the IETF
 * "Health Check Response Format for HTTP APIs" (draft-inadarei-api-health-check):
 * each check is { status: HealthStatus.Pass | HealthStatus.Warn | HealthStatus.Fail, output, time }, where
 * output says why in plain English and time (ISO) is when the check's
 * observation was made (null when there is none yet).
 *
 * Each check is a pure function of a status() snapshot (the trade engine's,
 * server/tradeEngine/host.js, with each plug-in's own status), served by
 * GET /api/admin/health and shown on the admin Services page.
 */
import { HealthStatus, JobRunStatus, PluginState } from '../shared/appEnums.js';
import { TRADE_MONITOR_SERVICE_ID } from './tradeEngine/services/tradeMonitor.js';

/**
 * @typedef {{ status: import('../shared/appEnums.js').HealthStatusId, output: string, time: string | null }} HealthCheck
 * @typedef {ReturnType<ReturnType<typeof import('./tradeEngine/host.js').createTradeEngine>['status']>} EngineStatus
 * @typedef {EngineStatus['plugins'][number] & Record<string, any>} PluginStatus
 */

const iso = (/** @type {number | null} */ ms) => (ms === null ? null : new Date(ms).toISOString());
const count = (/** @type {number} */ n, /** @type {string} */ noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The signals service's last run: passes when it worked, warns when some
 * signals failed, fails when the run itself failed.
 * @param {import('./tradeEngine/services/signals.js').LastRun | null} lastRun
 * @returns {HealthCheck}
 */
function signalsHealth(lastRun) {
  if (!lastRun) return { status: HealthStatus.Pass, output: 'No run yet · runs when a strategy has a new signal', time: null };
  const time = iso(lastRun.at);
  if (lastRun.error !== null) return { status: HealthStatus.Fail, output: `Last run failed · ${lastRun.error}`, time };
  const summary = `Last run · ${count(lastRun.users, 'user')} · ${count(lastRun.signals, 'signal')}`;
  if (lastRun.failed > 0) return { status: HealthStatus.Warn, output: `${summary} · ${lastRun.failed} failed`, time };
  return { status: HealthStatus.Pass, output: summary, time };
}

/**
 * The trade engine, the one check Admin Services shows for trading: warns
 * while it stands by (another server holds it), fails when a plug-in couldn't
 * start, then reports the trade monitor's problem, a plug-in handler that
 * failed, or the signals service's last run's. When all is well it says how
 * the last run went and what the monitor is watching.
 * @param {EngineStatus} engine
 * @returns {HealthCheck}
 */
export function tradeEngineHealth({ running, plugins }) {
  if (!running) return { status: HealthStatus.Warn, output: 'Standing by · not holding the engine lock', time: null };
  const notStarted = plugins.find((plugin) => plugin.state === PluginState.Failed);
  if (notStarted) return { status: HealthStatus.Fail, output: `${notStarted.id} could not start · ${notStarted.error}`, time: null };
  const monitor = tradeMonitorHealth(plugins.find((plugin) => plugin.id === TRADE_MONITOR_SERVICE_ID));
  if (monitor.status !== HealthStatus.Pass) return { ...monitor, output: `Trade monitor · ${monitor.output}` };
  const erred = plugins.find((plugin) => plugin.error !== null);
  if (erred) return { status: HealthStatus.Warn, output: `${erred.id} failed · ${erred.error}`, time: null };
  /** @type {import('./tradeEngine/services/signals.js').LastRun | null} */
  const lastRun = /** @type {PluginStatus | undefined} */ (plugins.find((plugin) => 'lastRun' in plugin))?.lastRun ?? null;
  const signals = signalsHealth(lastRun);
  if (signals.status !== HealthStatus.Pass) return signals;
  return { status: HealthStatus.Pass, output: `${signals.output} · ${monitor.output}`, time: signals.time ?? monitor.time };
}

/**
 * The trade monitor (the engine's tradeMonitor service), part of the trade
 * engine's check: fails when it isn't running, when loading the open positions
 * failed, or when open automated positions go unwatched for want of an admin Kite login.
 * @param {PluginStatus | undefined} status  the monitor's row of the engine's status
 * @returns {HealthCheck}
 */
export function tradeMonitorHealth(status) {
  if (status?.state !== PluginState.Running) return { status: HealthStatus.Fail, output: `Not running${status?.error ? ` · ${status.error}` : ''}`, time: null };
  if (status.lastError !== null) return { status: HealthStatus.Fail, output: `Loading positions failed · ${status.lastError}`, time: null };
  if (!status.marketOpen) return { status: HealthStatus.Pass, output: 'Market closed · watches automated positions in market hours', time: null };
  if (status.waitingForLogin) {
    return { status: HealthStatus.Fail, output: `${count(status.watchedPositions, 'open position')} unwatched · no admin Kite login`, time: null };
  }
  if (!status.feedConnected) return { status: HealthStatus.Pass, output: 'No open automated positions', time: null };
  const watching = `Watching ${count(status.watchedPositions, 'position')} in ${count(status.watchedInstruments, 'instrument')}`;
  if (status.lastTickAt === null) return { status: HealthStatus.Pass, output: `${watching} · no tick yet`, time: null };
  return { status: HealthStatus.Pass, output: `${watching} · last tick`, time: iso(status.lastTickAt) };
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
  if (jobs.length === 0) return { status: HealthStatus.Pass, output: 'No nightly jobs', time: null };
  const of = (/** @type {number} */ n) => `${n} of ${jobs.length}`;
  const failed = jobs.filter((job) => job.status === JobRunStatus.Failed);
  if (failed.length > 0) {
    return { status: HealthStatus.Fail, output: `${of(failed.length)} failed for ${day} · ${failed[0].file}: ${failed[0].error ?? 'no error saved'}`, time: null };
  }
  const done = jobs.filter((job) => job.status === JobRunStatus.Done).length;
  if (done === jobs.length) return { status: HealthStatus.Pass, output: `All ${count(jobs.length, 'job')} done for ${day}`, time: null };
  if (jobs.some((job) => job.status === JobRunStatus.Running)) return { status: HealthStatus.Pass, output: `Running for ${day} · ${of(done)} done`, time: null };
  return { status: HealthStatus.Warn, output: `${of(jobs.length - done)} not run for ${day}`, time: null };
}

/** A check whose status couldn't be read (e.g. the database is down). */
export function unreadableHealth(/** @type {string} */ what, /** @type {unknown} */ err) {
  const reason = err instanceof Error ? err.message : String(err);
  return /** @type {HealthCheck} */ ({ status: HealthStatus.Fail, output: `Couldn't read the ${what} · ${reason}`, time: null });
}
