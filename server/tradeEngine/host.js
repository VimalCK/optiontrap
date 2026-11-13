/**
 * The plug-in host: a runtime alive as long as the server that starts and
 * stops plug-ins of the shape { id, start(ctx), stop?(), status?(), health?() }. The
 * server runs two:
 *   the trade engine (createTradeEngine; server/tradeEngine/index.js builds it
 *     with the real plug-ins):
 *       services    the engine's ongoing work: orders (place, fill, cancel,
 *                   every order manual or automated), signals (a strategy's
 *                   signals → each user's settings and entry rules → orders),
 *                   tradeMonitor (exit rules on open automated positions)
 *       strategies  what to trade; each decides when and how it runs
 *                   (server/tradeEngine/strategies/)
 *   the scheduled jobs (server/scheduledJobs.js): OI snapshots, OI history,
 *     the stock scan, the instrument sync, the nightly jobs and signal outcomes.
 * A host starts its groups of plug-ins in order and stops them in reverse,
 * and gives each one a context:
 *   ctx.market    the market clock (market.js): onOpen, onClose, every,
 *                 daily, afterClose, repeat, isOpen
 *   ctx.services  the host's services by id; plug-ins reach each other only here
 *   ctx.log       the host's log under the plug-in's name
 * The host knows none of its plug-ins and holds no trading or job logic.
 * A plug-in that fails to start, or a handler that throws, is logged and
 * shown in status(); every other plug-in keeps running.
 *
 * Only one copy of a host runs across servers: start() takes a Postgres
 * advisory lock (its own name per host) held for the process's life. A server
 * that can't get it stands by and tries again every LOCK_RETRY_MS, taking
 * over if the holder goes away. The two hosts hold different locks, so the
 * trade engine and the jobs never wait on each other.
 */
import { tryHoldNamedAdvisoryLock } from '../db.js';
import { engineLogger } from '../engineLog.js';
import { createMarket } from './market.js';
import { PluginKind, PluginState } from '../../shared/appEnums.js';

const TRADE_ENGINE_LOCK = 'trade-engine';
const LOCK_RETRY_MS = 10_000;

/**
 * @typedef {{ market: import('./market.js').PluginMarket, services: Record<string, any>, log: (event: string, details?: import('../engineLog.js').EngineLogDetails) => void }} PluginContext
 * @typedef {{ id: string, start: (ctx: PluginContext) => unknown, stop?: () => unknown, status?: () => Record<string, unknown>, health?: () => import('../serviceHealth.js').HealthCheck }} Plugin
 *   health  the plug-in's own check (pass / warn / fail) for Admin Services, which folds them without knowing any plug-in
 * @typedef {{ kind: import('../../shared/appEnums.js').PluginKindId, plugins: Plugin[] }} PluginGroup
 * @typedef {{ plugin: Plugin, kind: import('../../shared/appEnums.js').PluginKindId, state: import('../../shared/appEnums.js').PluginStateId, error: string | null, dispose: (() => void) | null }} PluginRun
 * @typedef {{ release: () => Promise<void> }} HeldLock
 * @typedef {{
 *   market?: ReturnType<typeof createMarket>,
 *   holdLock?: (name: string, onLost: () => void) => Promise<HeldLock | null>,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: unknown) => void,
 *   logFor?: (name: string) => PluginContext['log'],
 * }} HostDeps  everything a host talks to, injectable for tests
 */

/**
 * @param {{
 *   name: string,
 *   lockName: string,
 *   groups: PluginGroup[],
 *   services?: Plugin[],
 * } & HostDeps} options
 *   name      the host's own name in its log
 *   lockName  the advisory lock that keeps one copy running across servers
 *   groups    the plug-ins, started group by group in this order
 *   services  the plug-ins every plug-in reaches through ctx.services
 */
export function createPluginHost({
  name,
  lockName,
  groups,
  services = [],
  market,
  holdLock = tryHoldNamedAdvisoryLock,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(/** @type {NodeJS.Timeout} */ (timer)),
  logFor = engineLogger,
}) {
  const log = logFor(name);
  /** @type {Map<string, PluginRun>} */
  const runs = new Map();
  for (const { kind, plugins } of groups) {
    for (const plugin of plugins) runs.set(plugin.id, { plugin, kind, state: PluginState.Stopped, error: null, dispose: null });
  }
  const servicesById = Object.fromEntries(services.map((s) => [s.id, s]));

  const marketClock = market ?? createMarket({ onError: (id, err) => failed(id, err, 'handler failed') });
  /** @type {HeldLock | null} */
  let lock = null;
  let retryTimer = null;
  let running = false;

  /** Note a plug-in's error for status() and the log; it stays running. */
  function failed(/** @type {string} */ id, /** @type {Error} */ err, /** @type {string} */ what) {
    const run = runs.get(id);
    if (run) run.error = err.message;
    log(what, { plugin: id, error: err.message });
  }

  async function startPlugin(/** @type {PluginRun} */ run) {
    const scope = marketClock.forPlugin(run.plugin.id);
    try {
      await run.plugin.start({ market: scope, services: servicesById, log: logFor(run.plugin.id) });
      run.state = PluginState.Running;
      run.error = null;
      run.dispose = scope.dispose;
    } catch (err) {
      scope.dispose();
      run.state = PluginState.Failed;
      failed(run.plugin.id, /** @type {Error} */ (err), 'could not start');
    }
  }

  async function stopPlugin(/** @type {PluginRun} */ run) {
    run.dispose?.();
    run.dispose = null;
    if (run.state === PluginState.Running) {
      try {
        await run.plugin.stop?.();
      } catch (err) {
        failed(run.plugin.id, /** @type {Error} */ (err), 'could not stop');
      }
    }
    run.state = PluginState.Stopped;
  }

  /** Each group in order (a later group may use an earlier one), then the clock. */
  async function startPlugins() {
    for (const { kind } of groups) {
      for (const run of runs.values()) if (run.kind === kind) await startPlugin(run);
    }
    marketClock.start();
    running = true;
    log('started', Object.fromEntries(groups.map(({ kind, plugins }) => [kind, plugins.length])));
  }

  /** The clock first, then the plug-ins in reverse: the reverse of starting. */
  async function stopPlugins() {
    marketClock.stop();
    for (const run of [...runs.values()].reverse()) await stopPlugin(run);
    running = false;
  }

  /** The lock dropped (its connection died): stop running and try to take it back. */
  async function lockLost() {
    lock = null;
    log('lost its lock', { lock: lockName, next: 'standing by' });
    await stopPlugins();
    retry();
  }

  function retry() {
    retryTimer = setTimer(() => { retryTimer = null; host.start(); }, LOCK_RETRY_MS);
  }

  const host = {
    services: servicesById,

    /** Run the host if this server can hold the lock; otherwise stand by and try again. */
    async start() {
      if (running || retryTimer !== null) return;
      try {
        lock = await holdLock(lockName, () => { lockLost(); });
      } catch (err) {
        log('could not take its lock', { lock: lockName, error: /** @type {Error} */ (err).message, next: 'trying again' });
      }
      if (!lock) {
        retry();
        return;
      }
      await startPlugins();
    },

    /** Stop every plug-in and free the lock (server shutdown). */
    async stop() {
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      await stopPlugins();
      await lock?.release();
      lock = null;
    },

    /** Whether this server runs the host, and each plug-in's state, for Admin Services. */
    status: () => ({
      running,
      plugins: [...runs.values()].map(({ plugin, kind, state, error }) => ({
        id: plugin.id,
        kind,
        state,
        error,
        ...(state === PluginState.Running ? { ...plugin.status?.(), health: plugin.health?.() ?? null } : { health: null }),
      })),
    }),
  };
  return host;
}

/**
 * The trade engine: services first (strategies use them through ctx.services),
 * then strategies.
 * @param {{ services: Plugin[], strategies: Plugin[] } & HostDeps} deps
 */
export function createTradeEngine({ services, strategies, ...deps }) {
  return createPluginHost({
    name: 'Engine',
    lockName: TRADE_ENGINE_LOCK,
    groups: [{ kind: PluginKind.Service, plugins: services }, { kind: PluginKind.Strategy, plugins: strategies }],
    services,
    ...deps,
  });
}
