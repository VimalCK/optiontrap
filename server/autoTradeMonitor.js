/**
 * The trade monitor: closes open automated paper positions when one of their
 * owner's active exit rules fires (shared/exitRules/: stop-loss, target,
 * square off at a time, max loss per day), on the live tick that crosses it.
 *
 * - Watches every open automated position, across all users, while the
 *   market is open (IST, trading days). Positions are loaded when the market
 *   opens, and one user's again when their positions or settings change
 *   (refreshUser, called by the routes and, later, the trade engine).
 * - Prices come from the server's own Kite ticker feed (kiteTickerFeed.js,
 *   admin session, LTP mode, shared with the paper order book through
 *   sharedTickerFeed.js): one feed for all users, subscribed to exactly
 *   the instruments held. Each tick runs the exit rules of every position in
 *   that instrument. A clock check every second runs them on the last price
 *   too, so "square off at" fires on time even if an instrument goes quiet.
 * - Rules compare the position's P&L at the last traded price, and the exit
 *   is at that last price. The owner's P&L for the day (booked, loaded from
 *   the DB and reloaded after each exit, plus open at the last prices) is
 *   there too, for the max loss per day rule. The exit goes through the one paper-trading exit
 *   (paperTrading.js, so the paper trade rules apply), which also closes the
 *   automated trades behind the position, with the rule's reason.
 * - Exit rules protect open positions whether automation is switched on or
 *   off; switching it off stops new trades, not exits.
 */
import {
  getAllOpenAutoPositions,
  getAutomationConfigs,
  getOpenAutoPositions,
  getTodayAutoRealisedPnl,
} from './db.js';
import { exitPaperTrade, NOT_FOUND } from './paperTrading.js';
import { openSharedTickerFeed } from './sharedTickerFeed.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';
import { isMarketOpen } from './marketClock.js';
import { marketDate, marketDayStartMs } from '../shared/marketTime.js';
import { checkExitRules } from '../shared/exitRules/index.js';
import { paperPnl, paperPnlPercent } from '../shared/paperPnl.js';

/** How often the market-open state is checked (connect at the open, disconnect after the close). */
const MARKET_CHECK_MS = 60 * 1000;
/** How often every position is checked on its last price, for time-based rules. */
const CLOCK_CHECK_MS = 1000;
const LOG_PREFIX = '[Trade Monitor]';

/**
 * @typedef {{ id: string, userId: string, instrumentToken: number, tradingsymbol: string, side: string, quantity: number, entryPrice: number }} WatchedPosition
 * @typedef {import('../shared/rules/ruleSettings.js').RuleSettings} RuleSettings
 * @typedef {{ position: WatchedPosition, exitPrice: number, ruleId: string, reason: string }} DueExit
 */

/**
 * Each user's open P&L at the last prices; positions with no price yet count as 0.
 * @param {Iterable<WatchedPosition>} positions
 * @param {Map<number, number>} lastPrices  instrument token → last traded price
 * @returns {Map<string, number>} user id → open P&L in ₹
 */
export function openPnlByUser(positions, lastPrices) {
  const totals = new Map();
  for (const position of positions) {
    const price = lastPrices.get(position.instrumentToken);
    if (price !== undefined) totals.set(position.userId, (totals.get(position.userId) ?? 0) + paperPnl(position, price));
  }
  return totals;
}

/**
 * The positions an exit rule says to close now, each at its last price.
 * Positions with no price yet, or whose owner has no rules loaded, stay open.
 * `todayPnlByUser` is each owner's automated P&L today, booked plus open
 * (0 when missing), for the max loss per day rule.
 * @param {WatchedPosition[]} positions
 * @param {{ lastPrices: Map<number, number>, exitRulesByUser: Map<string, RuleSettings>, todayPnlByUser: Map<string, number>, now: Date }} state
 * @returns {DueExit[]}
 */
export function dueExits(positions, { lastPrices, exitRulesByUser, todayPnlByUser, now }) {
  /** @type {DueExit[]} */
  const due = [];
  for (const position of positions) {
    const price = lastPrices.get(position.instrumentToken);
    const rules = exitRulesByUser.get(position.userId);
    if (price === undefined || !rules) continue;
    const ctx = { now, todayAutoPnl: todayPnlByUser.get(position.userId) ?? 0 };
    const fired = checkExitRules({ ...position, pnl: paperPnl(position, price), pnlPercent: paperPnlPercent(position, price) }, ctx, rules);
    if (fired) due.push({ position, exitPrice: price, ...fired });
  }
  return due;
}

/**
 * A trade monitor. Everything it talks to is injectable, for tests.
 * @param {{
 *   db?: { getAllOpenAutoPositions: typeof getAllOpenAutoPositions, getOpenAutoPositions: typeof getOpenAutoPositions,
 *          getAutomationConfigs: typeof getAutomationConfigs, getTodayAutoRealisedPnl: typeof getTodayAutoRealisedPnl },
 *   exitPosition?: typeof exitPaperTrade,
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   createFeed?: typeof openSharedTickerFeed,
 *   clock?: () => Date,
 *   log?: (message: string) => void,
 * }} [deps]
 */
export function createAutoTradeMonitor({
  db = { getAllOpenAutoPositions, getOpenAutoPositions, getAutomationConfigs, getTodayAutoRealisedPnl },
  exitPosition = exitPaperTrade,
  findKiteSession = findWorkingAdminSession,
  createFeed = openSharedTickerFeed,
  clock = () => new Date(),
  log = (message) => console.log(`${LOG_PREFIX} ${message}`),
} = {}) {
  /** @type {Map<string, WatchedPosition>} position id → position */
  const watched = new Map();
  /** @type {Map<string, RuleSettings>} */
  const exitRulesByUser = new Map();
  /** @type {Map<string, number>} user id → automated P&L booked today */
  const bookedPnlByUser = new Map();
  /** @type {Map<number, number>} */
  const lastPrices = new Map();
  /** Positions being exited right now, so a burst of ticks exits each once. */
  const exiting = new Set();
  /** @type {ReturnType<typeof openSharedTickerFeed> | null} */
  let feed = null;
  /** The market day positions were loaded for, and the day "no admin login" was last logged. */
  let loadedDate = null;
  let waitingLoggedDate = null;

  const watchedTokens = () => [...new Set([...watched.values()].map((p) => p.instrumentToken))];

  /** Reload the user's automated P&L booked today from the DB. */
  async function loadBookedPnl(/** @type {string} */ userId) {
    const todayStart = new Date(marketDayStartMs(clock().getTime())).toISOString();
    bookedPnlByUser.set(userId, await db.getTodayAutoRealisedPnl(userId, todayStart));
  }

  /** Track exactly these users' positions, exit rules and booked P&L, replacing what was held for them. */
  async function track(userIds, positions) {
    const configs = await db.getAutomationConfigs(userIds);
    await Promise.all(userIds.map(loadBookedPnl));
    for (const [id, position] of watched) if (userIds.includes(position.userId)) watched.delete(id);
    for (const userId of userIds) exitRulesByUser.set(userId, configs.get(userId).exitRules);
    for (const position of positions) watched.set(position.id, position);
    feed?.watch(watchedTokens());
  }

  async function loadAll() {
    const positions = await db.getAllOpenAutoPositions();
    watched.clear();
    exitRulesByUser.clear();
    bookedPnlByUser.clear();
    await track([...new Set(positions.map((p) => p.userId))], positions);
    log(`watching ${watched.size} open automated position(s)`);
  }

  /** Exit one position at its due price; the exit closes the automated trades behind it with the rule's reason. */
  async function exit({ position, exitPrice, ruleId, reason }) {
    if (exiting.has(position.id)) return;
    exiting.add(position.id);
    try {
      const result = await exitPosition(position.userId, position.id, exitPrice, { now: clock(), exitReason: { ruleId, reason } });
      if (result.ok) {
        log(`${position.tradingsymbol} [${position.userId}] exited at ${exitPrice}: ${reason}`);
      } else if (result.code !== NOT_FOUND) {
        log(`${position.tradingsymbol} [${position.userId}] could not exit: ${result.message}`);
        return; // still open: the next tick or clock check tries again
      }
      watched.delete(position.id); // exited now, or already exited elsewhere
      feed?.watch(watchedTokens());
      // After the delete, so the exit is never counted as both open and booked.
      await loadBookedPnl(position.userId)
        .catch((err) => log(`[${position.userId}] could not reload today's booked P&L: ${err.message}`));
    } catch (err) {
      log(`${position.tradingsymbol} [${position.userId}] exit failed: ${/** @type {Error} */ (err).message}`);
    } finally {
      exiting.delete(position.id);
    }
  }

  /** Run the exit rules on these positions at their last prices, and exit the ones due. */
  function check(positions) {
    const state = { lastPrices, exitRulesByUser, todayPnlByUser: todayPnlByUser(), now: clock() };
    return Promise.all(dueExits(positions, state).map(exit));
  }

  /** Each user's automated P&L today: booked plus every watched position at its last price. */
  function todayPnlByUser() {
    const totals = openPnlByUser(watched.values(), lastPrices);
    for (const [userId, booked] of bookedPnlByUser) totals.set(userId, (totals.get(userId) ?? 0) + booked);
    return totals;
  }

  /** @param {import('../shared/kiteTicks.js').Tick[]} ticks */
  function onTicks(ticks) {
    for (const tick of ticks) lastPrices.set(tick.instrumentToken, tick.lastPrice);
    const tokens = new Set(ticks.map((t) => t.instrumentToken));
    return check([...watched.values()].filter((p) => tokens.has(p.instrumentToken)));
  }

  function stopFeed() {
    feed?.close();
    feed = null;
    lastPrices.clear();
  }

  async function startFeed(date) {
    const kite = await findKiteSession();
    if (!kite) {
      if (waitingLoggedDate !== date) log('waiting for an admin Kite login today to watch automated positions');
      waitingLoggedDate = date;
      return;
    }
    feed = createFeed({
      kite,
      onTicks: (ticks) => { onTicks(ticks); },
      onAuthError: () => { log('the admin Kite session expired; trying again at the next check'); stopFeed(); },
    });
    feed.watch(watchedTokens());
  }

  /** Open at the market open (loading positions once a day), close after it. */
  async function checkMarket() {
    const now = clock();
    if (!isMarketOpen(now)) {
      if (feed) log('market closed; stopped watching');
      stopFeed();
      return;
    }
    const date = marketDate(now);
    if (loadedDate !== date) {
      await loadAll();
      loadedDate = date;
    }
    if (!feed && watched.size > 0) await startFeed(date);
  }

  return {
    onTicks,
    checkMarket,
    /** Check every watched position on its last price (time-based rules). */
    checkClock: () => (feed ? check([...watched.values()]) : Promise.resolve([])),
    /** Reload one user's open automated positions and exit rules (after a change). */
    async refreshUser(/** @type {string} */ userId) {
      if (loadedDate === null) return; // not watching yet: the market-open load will include them
      await track([userId], await db.getOpenAutoPositions(userId));
      if (!feed && watched.size > 0 && isMarketOpen(clock())) await startFeed(marketDate(clock()));
    },
    /** The user's open automated P&L at the last prices (positions with no price yet count as 0). */
    openPnl: (/** @type {string} */ userId) => openPnlByUser(watched.values(), lastPrices).get(userId) ?? 0,
    /** What is being watched, for tests and logs. */
    watchedPositionIds: () => [...watched.keys()],
  };
}

const monitor = createAutoTradeMonitor();

/** Reload a user's automated positions and exit rules after they changed; never throws. */
export function refreshAutoTradeMonitor(/** @type {string} */ userId) {
  monitor.refreshUser(userId).catch((err) => console.warn(`${LOG_PREFIX} refresh failed:`, err.message));
}

/** A user's open automated P&L now, from the monitor's live prices (for the daily loss entry rule). */
export function openAutoTradePnl(/** @type {string} */ userId) {
  return monitor.openPnl(userId);
}

/** Start watching: the market check every minute, the clock check every second. */
export function startAutoTradeMonitor() {
  const run = (/** @type {() => Promise<unknown>} */ fn, /** @type {string} */ what) => () =>
    fn().catch((err) => console.warn(`${LOG_PREFIX} ${what} failed:`, err.message));
  const checkMarket = run(monitor.checkMarket, 'market check');
  checkMarket();
  setInterval(checkMarket, MARKET_CHECK_MS).unref();
  setInterval(run(monitor.checkClock, 'clock check'), CLOCK_CHECK_MS).unref();
}
