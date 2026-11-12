/**
 * The trade monitor service: closes open automated paper positions when one
 * of their owner's active exit rules fires (shared/exitRules/: stop-loss,
 * target, square off at a time, max loss per day), on the live tick that
 * crosses it. A trade engine service (server/tradeEngine/host.js).
 *
 * - Runs on the market clock (ctx.market): at each open it loads every open
 *   automated position, across all users, and watches them; after the close
 *   it stops. One user's are loaded again when their positions or settings
 *   change: refreshUser, from the settings route and the signals service, and
 *   on every position the user exits by hand (an order service closing order).
 * - Prices come from the server's own Kite ticker feed (kiteTickerFeed.js,
 *   admin session, LTP mode, shared with the order service through
 *   sharedTickerFeed.js): one feed for all users, subscribed to exactly the
 *   instruments held. Each tick runs the exit rules of every position in that
 *   instrument. A check every second runs them on the last price too, so
 *   "square off at" fires on time even if an instrument goes quiet.
 * - Rules compare the position's P&L at the last traded price. The owner's
 *   P&L for the day (booked, loaded from the DB and reloaded after each exit,
 *   plus open at the last prices) is there too, for the max loss per day rule.
 * - An exit is an order through the order service (ctx.services.orders.exit):
 *   a market order filled at the bid / ask, which also closes the automated
 *   trades behind the position, with the rule's reason.
 * - Exit rules protect open positions whether automation is switched on or
 *   off; switching it off stops new trades, not exits.
 */
import {
  getAllOpenAutoPositions,
  getOpenAutoPositions,
  getTodayAutoRealisedPnl,
} from '../../db.js';
import { getAutomationConfigs } from '../automationConfigs.js';
import { NOT_FOUND } from '../positions.js';
import { openSharedTickerFeed } from '../../sharedTickerFeed.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { marketDate, marketDayStartMs } from '../../../shared/marketTime.js';
import { checkExitRules } from '../../../shared/exitRules/index.js';
import { paperPnl, paperPnlPercent } from '../../../shared/paperPnl.js';
import { algoLogger } from '../../algoLog.js';
import { TradeSource } from '../../../shared/tradeEnums.js';

/** How often every position is checked on its last price, for time-based rules. */
const CLOCK_CHECK_MS = 1000;
/** How often, in market hours, the feed is started if positions are watched and it isn't running (e.g. no admin login yet). */
const FEED_CHECK_MS = 60 * 1000;

/**
 * @typedef {{ id: string, userId: string, instrumentToken: number, tradingsymbol: string, side: string, quantity: number, entryPrice: number }} WatchedPosition
 * @typedef {import('../../../shared/rules/ruleSettings.js').RuleSettings} RuleSettings
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
 * A trade monitor service. Everything it talks to is injectable, for tests;
 * the order service comes from the engine (ctx.services.orders).
 * @param {{
 *   db?: { getAllOpenAutoPositions: typeof getAllOpenAutoPositions, getOpenAutoPositions: typeof getOpenAutoPositions,
 *          getAutomationConfigs: typeof getAutomationConfigs, getTodayAutoRealisedPnl: typeof getTodayAutoRealisedPnl },
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   createFeed?: typeof openSharedTickerFeed,
 *   clock?: () => Date,
 *   log?: (event: string, details?: import('../../algoLog.js').AlgoDetails) => void,
 * }} [deps]
 */
export function createTradeMonitor({
  db = { getAllOpenAutoPositions, getOpenAutoPositions, getAutomationConfigs, getTodayAutoRealisedPnl },
  findKiteSession = findWorkingAdminSession,
  createFeed = openSharedTickerFeed,
  clock = () => new Date(),
  log = algoLogger('Monitor'),
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
  /** The order service exits go through, and the market clock (from the engine at start). */
  let orders = null;
  /** @type {import('../market.js').PluginMarket | null} */
  let market = null;
  /** @type {ReturnType<typeof openSharedTickerFeed> | null} */
  let feed = null;
  /** The admin Kite session the feed runs on; exits take their bid / ask quote with it. */
  let feedKite = null;
  /** Stops listening to the order service's settled orders. */
  let stopListening = () => {};
  /** Whether the session's positions are loaded (from the open until the close), and the day "no admin login" was last logged. */
  let loaded = false;
  let waitingLoggedDate = null;
  /** For status(): whether it waits for an admin login, the last tick (ms), and why the last load failed. */
  let waitingForLogin = false;
  let lastTickAt = null;
  /** @type {string | null} */
  let lastError = null;

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
    log('loaded positions', { watching: watched.size });
  }

  /** Exit one position at its due price through the order service; the exit closes the automated trades behind it with the rule's reason. */
  async function exit({ position, exitPrice, ruleId, reason }) {
    if (exiting.has(position.id)) return;
    exiting.add(position.id);
    try {
      // A market exit: at the bid / ask from a quote with the feed's session (exitPrice when it has none).
      const result = await orders.exit(position.userId, position.id, { exitPrice, kite: feedKite, source: TradeSource.Auto, exitReason: { ruleId, reason } });
      if (result.ok) {
        log('exit fired', { position: `${position.side} ${position.quantity} ${position.tradingsymbol}`, price: result.order.fillPrice, last: exitPrice, user: position.userId, reason });
      } else if (result.code !== NOT_FOUND) {
        log('could not exit', { position: position.tradingsymbol, user: position.userId, reason: result.message, next: 'tries again on the next tick' });
        return; // still open: the next tick or clock check tries again
      }
      watched.delete(position.id); // exited now, or already exited elsewhere
      feed?.watch(watchedTokens());
      // After the delete, so the exit is never counted as both open and booked.
      await loadBookedPnl(position.userId)
        .catch((err) => log("could not reload today's booked P&L", { user: position.userId, error: err.message }));
    } catch (err) {
      log('exit failed', { position: position.tradingsymbol, user: position.userId, error: /** @type {Error} */ (err).message });
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

  /** @param {import('../../../shared/kiteTicks.js').Tick[]} ticks */
  function onTicks(ticks) {
    if (ticks.length > 0) lastTickAt = clock().getTime();
    for (const tick of ticks) lastPrices.set(tick.instrumentToken, tick.lastPrice);
    const tokens = new Set(ticks.map((t) => t.instrumentToken));
    return check([...watched.values()].filter((p) => tokens.has(p.instrumentToken)));
  }

  function stopFeed() {
    feed?.close();
    feed = null;
    feedKite = null;
    waitingForLogin = false;
    lastPrices.clear();
  }

  /** Start the feed while the session is loaded and positions are watched, if it isn't running (needs an admin login). */
  async function ensureFeed() {
    if (!loaded || feed || watched.size === 0) return;
    const kite = await findKiteSession();
    waitingForLogin = !kite;
    if (!kite) {
      const date = marketDate(clock());
      if (waitingLoggedDate !== date) log('waiting for an admin Kite login', { why: 'to watch automated positions today' });
      waitingLoggedDate = date;
      return;
    }
    feedKite = kite;
    feed = createFeed({
      kite,
      onTicks: (ticks) => { onTicks(ticks); },
      onAuthError: () => { log('admin Kite session expired', { next: 'trying again at the next check' }); stopFeed(); },
    });
    feed.watch(watchedTokens());
  }

  /** At the open: load every open automated position and its owner's exit rules, then watch them. */
  async function openSession() {
    try {
      await loadAll();
      lastError = null;
    } catch (err) {
      lastError = /** @type {Error} */ (err).message;
      throw err;
    }
    loaded = true;
    await ensureFeed();
  }

  /** Reload one user's open automated positions and exit rules (after a change). */
  async function refreshUser(/** @type {string} */ userId) {
    if (!loaded) return; // not watching yet: the open's load will include them
    await track([userId], await db.getOpenAutoPositions(userId));
    await ensureFeed();
  }

  /** A position exited by hand may be an automated one this watches: reload its owner's. */
  async function onOrderSettled(/** @type {{ userId: string, source: string, closesPosition: boolean }} */ order) {
    if (order.closesPosition && order.source === TradeSource.Manual) await refreshUser(order.userId);
  }

  /** After the close: stop watching until the next open. */
  function closeSession() {
    if (feed) log('market closed', { feed: 'stopped watching' });
    stopFeed();
    loaded = false;
  }

  return {
    id: 'tradeMonitor',

    /** Run on the market clock: watch from each open, check time rules every second, stop after the close. */
    start(/** @type {import('../host.js').PluginContext} */ ctx) {
      orders = ctx.services.orders;
      market = ctx.market;
      stopListening = orders.onSettled(onOrderSettled);
      ctx.market.onOpen(openSession);
      ctx.market.onClose(closeSession);
      ctx.market.every(CLOCK_CHECK_MS, () => (feed ? check([...watched.values()]) : []));
      ctx.market.every(FEED_CHECK_MS, ensureFeed);
    },

    stop() {
      stopListening();
      closeSession();
      watched.clear();
    },

    onTicks,

    refreshUser,
    /** The user's open automated P&L at the last prices (positions with no price yet count as 0). */
    openPnl: (/** @type {string} */ userId) => openPnlByUser(watched.values(), lastPrices).get(userId) ?? 0,
    /** What is being watched, for tests and logs. */
    watchedPositionIds: () => [...watched.keys()],
    /** How the monitor is doing, for Admin Services. */
    status: () => ({
      marketOpen: market?.isOpen() ?? false,
      feedConnected: feed !== null,
      waitingForLogin,
      watchedPositions: watched.size,
      watchedInstruments: watchedTokens().length,
      lastTickAt,
      lastError,
    }),
  };
}
