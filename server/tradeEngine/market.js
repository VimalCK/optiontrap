/**
 * The market clock the trade engine gives every plug-in (ctx.market), so no
 * strategy or service writes its own timer and "is the market open?" check.
 *
 * One timer for the whole engine reads the IST clock every second
 * (shared/marketTime.js: trading days, 09:15–15:30 IST) and tells subscribers:
 *   onOpen(fn)       at each session's open; at once when the engine starts
 *                    while the market is open (a restart mid-session)
 *   onClose(fn)      after each session's close; once when the engine starts
 *                    while it is closed, so cleanup missed while the server
 *                    was down still happens
 *   every(ms, fn)    every `ms` while the market is open, first at the open;
 *                    a run still going skips the next beat, never overlaps
 * So open and close handlers must be safe to run twice.
 *
 * Each plug-in subscribes through its own scope (forPlugin), which the engine
 * disposes when it stops the plug-in. A handler that throws is reported for
 * that plug-in (onError) and never stops the clock or anyone else's handlers.
 */
import { isMarketOpen } from '../../shared/marketTime.js';

/** How often the clock is read. */
const TICK_MS = 1000;

/**
 * @typedef {() => unknown} Handler
 * @typedef {{ ms: number, fn: Handler, lastRunAt: number, running: boolean }} Repeat
 * @typedef {{ open: Set<Handler>, close: Set<Handler>, repeats: Set<Repeat> }} Subscriptions
 * @typedef {{
 *   isOpen: () => boolean,
 *   onOpen: (fn: Handler) => () => void,
 *   onClose: (fn: Handler) => () => void,
 *   every: (ms: number, fn: Handler) => () => void,
 * }} PluginMarket
 */

/**
 * A market clock. Time and timers are injectable, for tests.
 * @param {{
 *   clock?: () => Date,
 *   isOpen?: (now: Date) => boolean,
 *   onError?: (pluginId: string, err: Error) => void,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: unknown) => void,
 * }} [deps]
 */
export function createMarket({
  clock = () => new Date(),
  isOpen = isMarketOpen,
  onError = () => {},
  setTimer = (fn, ms) => setInterval(fn, ms).unref(),
  clearTimer = (timer) => clearInterval(/** @type {NodeJS.Timeout} */ (timer)),
} = {}) {
  /** @type {Map<string, Subscriptions>} plug-in id → its subscriptions */
  const plugins = new Map();
  /** Whether the market was open at the last tick; null before the first. @type {boolean | null} */
  let wasOpen = null;
  let timer = null;

  /** Run a handler for a plug-in, reporting a throw or rejection instead of letting it escape. */
  async function call(/** @type {string} */ pluginId, /** @type {Handler} */ fn) {
    try {
      await fn();
    } catch (err) {
      onError(pluginId, /** @type {Error} */ (err));
    }
  }

  function fire(/** @type {'open' | 'close'} */ event) {
    for (const [pluginId, subs] of plugins) for (const fn of subs[event]) call(pluginId, fn);
  }

  function runRepeats(/** @type {number} */ nowMs) {
    for (const [pluginId, subs] of plugins) {
      for (const repeat of subs.repeats) {
        if (repeat.running || nowMs - repeat.lastRunAt < repeat.ms) continue;
        repeat.lastRunAt = nowMs;
        repeat.running = true;
        call(pluginId, repeat.fn).finally(() => { repeat.running = false; });
      }
    }
  }

  /** Read the clock once: fire open / close on a change (or at the first tick), then the repeats due. */
  function tick() {
    const now = clock();
    const open = isOpen(now);
    if (open !== wasOpen) {
      if (!open) for (const subs of plugins.values()) for (const repeat of subs.repeats) repeat.lastRunAt = -Infinity;
      fire(open ? 'open' : 'close');
    }
    wasOpen = open;
    if (open) runRepeats(now.getTime());
  }

  return {
    /** Start reading the clock: the first tick now, then every second. */
    start() {
      if (timer !== null) return;
      tick();
      timer = setTimer(tick, TICK_MS);
    },

    /** Stop reading the clock; the next start() fires open or close again for the state then. */
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      wasOpen = null;
    },

    tick,

    /**
     * The market as one plug-in sees it: its subscriptions are kept apart so
     * dispose() drops them all when the plug-in stops.
     * @param {string} pluginId
     * @returns {PluginMarket & { dispose: () => void }}
     */
    forPlugin(pluginId) {
      /** @type {Subscriptions} */
      const subs = { open: new Set(), close: new Set(), repeats: new Set() };
      plugins.set(pluginId, subs);
      const add = (/** @type {Set<any>} */ set, /** @type {any} */ item) => {
        set.add(item);
        return () => { set.delete(item); };
      };
      return {
        isOpen: () => isOpen(clock()),
        onOpen: (fn) => add(subs.open, fn),
        onClose: (fn) => add(subs.close, fn),
        every: (ms, fn) => add(subs.repeats, { ms, fn, lastRunAt: -Infinity, running: false }),
        dispose: () => { plugins.delete(pluginId); },
      };
    },
  };
}
