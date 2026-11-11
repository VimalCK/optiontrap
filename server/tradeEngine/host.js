/**
 * The trade engine host: the one runtime for trading, alive as long as the
 * server (server/tradeEngine/index.js builds it with the real plug-ins).
 *
 * It is only a host. It holds two lists of plug-ins, both of the shape
 * { id, start(ctx), stop?(), status?() }:
 *   services    the engine's ongoing work: orders (place, fill, cancel, every
 *               order manual or automated), signals (a strategy's signals →
 *               each user's settings and entry rules → orders), tradeMonitor
 *               (exit rules on open automated positions)
 *   strategies  what to trade; each decides when and how it runs
 *               (server/tradeEngine/strategies/)
 * and gives each one a context:
 *   ctx.market    the market clock (market.js): onOpen, onClose, every, isOpen
 *   ctx.services  the services by id; plug-ins reach each other only here
 *   ctx.log       the algo log under the plug-in's name
 * The engine holds no trading logic: rules, orders, prices and positions live
 * in the services. A plug-in that fails to start, or a handler that throws,
 * is logged and shown on Admin Services; every other plug-in keeps running.
 *
 * Only one engine runs across servers: start() takes a Postgres advisory lock
 * held for the process's life. A server that can't get it stands by and tries
 * again every LOCK_RETRY_MS, taking over if the holder goes away.
 */
import { tryHoldNamedAdvisoryLock } from '../db.js';
import { algoLogger } from '../algoLog.js';
import { createMarket } from './market.js';

const LOCK_NAME = 'trade-engine';
/** How often a standing-by server tries to take over the engine. */
const LOCK_RETRY_MS = 10_000;

/**
 * @typedef {{ market: import('./market.js').PluginMarket, services: Record<string, any>, log: (event: string, details?: import('../algoLog.js').AlgoDetails) => void }} PluginContext
 * @typedef {{ id: string, start: (ctx: PluginContext) => unknown, stop?: () => unknown, status?: () => Record<string, unknown> }} Plugin
 * @typedef {'service' | 'strategy'} PluginKind
 * @typedef {{ plugin: Plugin, kind: PluginKind, state: 'stopped' | 'running' | 'failed', error: string | null, dispose: (() => void) | null }} PluginRun
 * @typedef {{ release: () => Promise<void> }} HeldLock
 */

/**
 * A trade engine. Everything it talks to is injectable, for tests.
 * @param {{
 *   services: Plugin[],
 *   strategies: Plugin[],
 *   market?: ReturnType<typeof createMarket>,
 *   holdLock?: (name: string, onLost: () => void) => Promise<HeldLock | null>,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: unknown) => void,
 *   logFor?: (name: string) => PluginContext['log'],
 * }} deps
 */
export function createTradeEngine({
  services,
  strategies,
  market,
  holdLock = tryHoldNamedAdvisoryLock,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(/** @type {NodeJS.Timeout} */ (timer)),
  logFor = algoLogger,
}) {
  const log = logFor('Engine');
  /** @type {Map<string, PluginRun>} */
  const runs = new Map();
  const add = (/** @type {Plugin} */ plugin, /** @type {PluginKind} */ kind) => runs.set(plugin.id, { plugin, kind, state: 'stopped', error: null, dispose: null });
  services.forEach((plugin) => add(plugin, 'service'));
  strategies.forEach((plugin) => add(plugin, 'strategy'));
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
      run.state = 'running';
      run.error = null;
      run.dispose = scope.dispose;
    } catch (err) {
      scope.dispose();
      run.state = 'failed';
      failed(run.plugin.id, /** @type {Error} */ (err), 'could not start');
    }
  }

  async function stopPlugin(/** @type {PluginRun} */ run) {
    run.dispose?.();
    run.dispose = null;
    if (run.state === 'running') {
      try {
        await run.plugin.stop?.();
      } catch (err) {
        failed(run.plugin.id, /** @type {Error} */ (err), 'could not stop');
      }
    }
    run.state = 'stopped';
  }

  /** Services first (strategies use them), then strategies, then the clock. */
  async function startPlugins() {
    for (const run of runs.values()) if (run.kind === 'service') await startPlugin(run);
    for (const run of runs.values()) if (run.kind === 'strategy') await startPlugin(run);
    marketClock.start();
    running = true;
    log('started', { services: services.length, strategies: strategies.length });
  }

  /** The clock first, then strategies, then services: the reverse of starting. */
  async function stopPlugins() {
    marketClock.stop();
    for (const run of [...runs.values()].reverse()) await stopPlugin(run);
    running = false;
  }

  /** The lock dropped (its connection died): stop running and try to take it back. */
  async function lockLost() {
    lock = null;
    log('lost the engine lock', { next: 'standing by' });
    await stopPlugins();
    retry();
  }

  function retry() {
    retryTimer = setTimer(() => { retryTimer = null; engine.start(); }, LOCK_RETRY_MS);
  }

  const engine = {
    services: servicesById,

    /** Run the engine if this server can hold the lock; otherwise stand by and try again. */
    async start() {
      if (running || retryTimer !== null) return;
      try {
        lock = await holdLock(LOCK_NAME, () => { lockLost(); });
      } catch (err) {
        log('could not take the engine lock', { error: /** @type {Error} */ (err).message, next: 'trying again' });
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

    /** Whether this server runs the engine, and each plug-in's state, for Admin Services. */
    status: () => ({
      running,
      plugins: [...runs.values()].map(({ plugin, kind, state, error }) => ({
        id: plugin.id,
        kind,
        state,
        error,
        ...(state === 'running' ? plugin.status?.() : {}),
      })),
    }),
  };
  return engine;
}
