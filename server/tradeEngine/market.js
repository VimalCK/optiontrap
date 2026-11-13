/**
 * The market clock every plug-in host gives its plug-ins (ctx.market): the
 * trade engine's strategies and services, and the scheduled jobs
 * (server/scheduledJobs.js). No plug-in writes its own timer, "is the market
 * open?" or "is it 08:30 IST yet?" check.
 *
 * One timer per host reads the IST clock every second (shared/marketTime.js:
 * trading days, 09:15–15:30 IST) and tells subscribers:
 *   onOpen(fn)       at each session's open; at once when the host starts
 *                    while the market is open (a restart mid-session)
 *   onClose(fn)      after each session's close; once when the host starts
 *                    while it is closed, so cleanup missed while the server
 *                    was down still happens
 *   every(ms, fn)    every `ms` while the market is open, first at the open
 *   daily(at, ms, fn)  every `ms` from `at` (minutes after midnight IST) to
 *                    midnight, every day; first at `at`, or at once when the
 *                    host starts later that day (a server down at `at`)
 *   afterClose(ms, fn) every `ms` on weekdays from 15 minutes after the close
 *                    to midnight; first then, or at once when started later
 *   repeat(ms, fn)   every `ms` at any time; first at once
 * A repeating handler decides itself when its work is done for the day; a run
 * still going skips the next beat, never overlaps. Open and close handlers
 * must be safe to run twice.
 *
 * Each plug-in subscribes through its own scope (forPlugin), which the host
 * disposes when it stops the plug-in. A handler that throws is reported for
 * that plug-in (onError) and never stops the clock or anyone else's handlers.
 */
import { MARKET_CLOSE_MINUTES, addDays, isMarketOpen, marketClock, marketDateTime } from '../../shared/marketTime.js';
import { MarketEvent } from '../../shared/tradeEnums.js';

const TICK_MS = 1000;

/** Fifteen minutes after the close, so the day's candles are final. */
export const AFTER_CLOSE_MINUTES = MARKET_CLOSE_MINUTES + 15;

/** Exchange holidays need no calendar: Kite returns no candle for the day, so the run stores nothing new. */
export function isAfterCloseOnWeekday(now = new Date()) {
  const { weekday, minutes } = marketClock(now);
  return weekday >= 1 && weekday <= 5 && minutes >= AFTER_CLOSE_MINUTES;
}

/** 08:30 market time: when the nightly jobs run, every day of the week. */
export const NIGHTLY_JOBS_MINUTES = 8 * 60 + 30;

/** A server that was down at 08:30 runs them as soon as it's back. */
export function isNightlyJobTime(now = new Date()) {
  return marketClock(now).minutes >= NIGHTLY_JOBS_MINUTES;
}

/** By 08:30 Zerodha has published the day's instrument list. */
export const INSTRUMENTS_REFRESH_MINUTES = 8 * 60 + 30;

/** A table loaded earlier than this is out of date. */
export function currentInstrumentListStart(now = new Date()) {
  const { date, minutes } = marketClock(now);
  const day = minutes >= INSTRUMENTS_REFRESH_MINUTES ? date : addDays(date, -1);
  return marketDateTime(day, INSTRUMENTS_REFRESH_MINUTES).getTime();
}

/**
 * @typedef {() => unknown} Handler
 * @typedef {(now: Date, open: boolean) => boolean} DueCheck  whether a repeat's window is on at `now`
 * @typedef {{ isDue: DueCheck, ms: number, fn: Handler, lastRunAt: number, running: boolean }} Repeat
 * @typedef {{ [MarketEvent.Open]: Set<Handler>, [MarketEvent.Close]: Set<Handler>, repeats: Set<Repeat> }} Subscriptions
 * @typedef {{
 *   isOpen: () => boolean,
 *   onOpen: (fn: Handler) => () => void,
 *   onClose: (fn: Handler) => () => void,
 *   every: (ms: number, fn: Handler) => () => void,
 *   daily: (atMinutes: number, ms: number, fn: Handler) => () => void,
 *   afterClose: (ms: number, fn: Handler) => () => void,
 *   repeat: (ms: number, fn: Handler) => () => void,
 * }} PluginMarket
 */

/** @type {DueCheck} */
const whileOpen = (_now, open) => open;
/** @type {DueCheck} */
const always = () => true;
/** @type {DueCheck} */
const afterCloseOnWeekday = (now) => isAfterCloseOnWeekday(now);
const fromTimeOfDay = (/** @type {number} */ atMinutes) => /** @type {DueCheck} */ ((now) => marketClock(now).minutes >= atMinutes);

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

  function fire(/** @type {import('../../shared/tradeEnums.js').MarketEventId} */ event) {
    for (const [pluginId, subs] of plugins) for (const fn of subs[event]) call(pluginId, fn);
  }

  /** Run each repeat that is due; one whose window is off starts afresh when it next opens. */
  function runRepeats(/** @type {Date} */ now, /** @type {boolean} */ open) {
    const nowMs = now.getTime();
    for (const [pluginId, subs] of plugins) {
      for (const repeat of subs.repeats) {
        if (!repeat.isDue(now, open)) {
          repeat.lastRunAt = -Infinity;
          continue;
        }
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
    if (open !== wasOpen) fire(open ? MarketEvent.Open : MarketEvent.Close);
    wasOpen = open;
    runRepeats(now, open);
  }

  return {
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
      const subs = { [MarketEvent.Open]: new Set(), [MarketEvent.Close]: new Set(), repeats: new Set() };
      plugins.set(pluginId, subs);
      const add = (/** @type {Set<any>} */ set, /** @type {any} */ item) => {
        set.add(item);
        return () => { set.delete(item); };
      };
      const addRepeat = (/** @type {DueCheck} */ isDue, /** @type {number} */ ms, /** @type {Handler} */ fn) =>
        add(subs.repeats, { isDue, ms, fn, lastRunAt: -Infinity, running: false });
      return {
        isOpen: () => isOpen(clock()),
        onOpen: (fn) => add(subs[MarketEvent.Open], fn),
        onClose: (fn) => add(subs[MarketEvent.Close], fn),
        every: (ms, fn) => addRepeat(whileOpen, ms, fn),
        daily: (atMinutes, ms, fn) => addRepeat(fromTimeOfDay(atMinutes), ms, fn),
        afterClose: (ms, fn) => addRepeat(afterCloseOnWeekday, ms, fn),
        repeat: (ms, fn) => addRepeat(always, ms, fn),
        dispose: () => { plugins.delete(pluginId); },
      };
    },
  };
}
