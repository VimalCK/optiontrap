/**
 * The trade monitor's automated channel: open automated paper positions, each closed when an active exit rule of
 * its strategy (shared/exitRules/: stop-loss, target and its trailing stop-loss, square off at a time) or one of its
 * owner's general rules (max loss per day, over every strategy) fires. Rules compare the position's P&L at the last
 * traded price, and at its best price while watched for the trailing stop-loss. The owner's automated P&L for the
 * day across strategies (booked, loaded from the DB and reloaded after each exit, plus open at the last prices) is
 * there too, for the max loss per day rule.
 *
 * Exit rules protect open positions whether automation, the strategy or an admin's switch for it is on or off;
 * switching off stops new trades, not exits. A rule that blocks entries (square off at, once its time has come; max
 * loss per day, once hit) also cancels the waiting automated entry orders it covers, on the monitor's every-second
 * check, so none fills only to be closed at once.
 */
import { getAllOpenAutoPositions, getOpenAutoPositions, getTodayAutoRealisedPnl } from '../../../db.js';
import { getAutomationConfigs } from '../../automationConfigs.js';
import { exitRuleSettings } from '../../../../shared/automation.js';
import { marketDayStartMs } from '../../../../shared/marketTime.js';
import { checkEntryOrderBlocked, checkExitRules } from '../../../../shared/exitRules/index.js';
import { cancelledByRule } from '../../../../shared/orders.js';
import { tradePnl, tradePnlPercent } from '../../../../shared/tradePnl.js';
import { TradeSource } from '../../../../shared/tradeEnums.js';
import { createPositionBook } from './positionBook.js';

/**
 * @typedef {import('../tradeMonitor.js').WatchedPosition} WatchedPosition
 * @typedef {import('../tradeMonitor.js').DueExit} DueExit
 * @typedef {import('../tradeMonitor.js').MonitorPrices} MonitorPrices
 * @typedef {import('../../../../shared/automation.js').AutomationConfig} AutomationConfig
 * @typedef {{ id: string, userId: string, instrumentToken: number, tradingsymbol: string, side: string, quantity: number,
 *             horizon: import('../../../../shared/tradeEnums.js').HorizonId, strategyId: string | null }} WaitingOrder
 * @typedef {{ order: WaitingOrder, ruleId: string, reason: string }} DueCancellation
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
    if (price !== undefined) totals.set(position.userId, (totals.get(position.userId) ?? 0) + tradePnl(position, price));
  }
  return totals;
}

/**
 * The positions an exit rule says to close now, each at its last price: its strategy's rules, then its owner's
 * general ones. Positions with no price yet, or whose owner's configuration isn't loaded, stay open.
 * `todayPnlByUser` is each owner's automated P&L today, booked plus open
 * (0 when missing), for the max loss per day rule. `bestPrices` holds each
 * position's best price while watched (its last price when missing).
 * @param {WatchedPosition[]} positions
 * @param {{ lastPrices: Map<number, number>, bestPrices: Map<string, number>, configsByUser: Map<string, AutomationConfig>,
 *           todayPnlByUser: Map<string, number>, now: Date }} state
 * @returns {DueExit[]}
 */
export function dueExits(positions, { lastPrices, bestPrices, configsByUser, todayPnlByUser, now }) {
  /** @type {DueExit[]} */
  const due = [];
  for (const position of positions) {
    const price = lastPrices.get(position.instrumentToken);
    const config = configsByUser.get(position.userId);
    if (price === undefined || !config) continue;
    const ctx = { now, todayAutoPnl: todayPnlByUser.get(position.userId) ?? 0 };
    const subject = {
      ...position,
      pnl: tradePnl(position, price),
      pnlPercent: tradePnlPercent(position, price),
      peakPnlPercent: tradePnlPercent(position, bestPrices.get(position.id) ?? price),
    };
    const fired = checkExitRules(subject, ctx, exitRuleSettings(config, position.strategyId ?? null));
    if (fired) due.push({ position, exitPrice: price, ...fired });
  }
  return due;
}

/**
 * The waiting automated entry orders a rule of their strategy or a general rule says to cancel now. Orders whose
 * owner's configuration isn't loaded stay.
 * @param {WaitingOrder[]} orders
 * @param {{ configsByUser: Map<string, AutomationConfig>, todayPnlByUser: Map<string, number>, now: Date }} state
 * @returns {DueCancellation[]}
 */
export function dueCancellations(orders, { configsByUser, todayPnlByUser, now }) {
  /** @type {DueCancellation[]} */
  const due = [];
  for (const order of orders) {
    const config = configsByUser.get(order.userId);
    if (!config) continue;
    const fired = checkEntryOrderBlocked(order, { now, todayAutoPnl: todayPnlByUser.get(order.userId) ?? 0 }, exitRuleSettings(config, order.strategyId));
    if (fired) due.push({ order, ...fired });
  }
  return due;
}

/**
 * @param {{
 *   db?: { getAllOpenAutoPositions: typeof getAllOpenAutoPositions, getOpenAutoPositions: typeof getOpenAutoPositions,
 *          getAutomationConfigs: typeof getAutomationConfigs, getTodayAutoRealisedPnl: typeof getTodayAutoRealisedPnl },
 *   prices: MonitorPrices,
 *   clock: () => Date,
 *   log: (event: string, details?: import('../../../engineLog.js').EngineLogDetails) => void,
 * }} deps
 */
export function createAutoChannel({
  db = { getAllOpenAutoPositions, getOpenAutoPositions, getAutomationConfigs, getTodayAutoRealisedPnl },
  prices,
  clock,
  log,
}) {
  const book = createPositionBook();
  /** @type {Map<string, AutomationConfig>} */
  const configsByUser = new Map();
  /** @type {Map<string, number>} user id → automated P&L booked today */
  const bookedPnlByUser = new Map();

  /** Reload the user's automated P&L booked today from the DB. */
  async function loadBookedPnl(/** @type {string} */ userId) {
    const todayStart = new Date(marketDayStartMs(clock().getTime())).toISOString();
    bookedPnlByUser.set(userId, await db.getTodayAutoRealisedPnl(userId, todayStart));
  }

  async function loadConfigs(/** @type {string[]} */ userIds) {
    const configs = await db.getAutomationConfigs(userIds);
    for (const userId of userIds) configsByUser.set(userId, configs.get(userId));
  }

  /** Track exactly these users' positions, configurations and booked P&L, replacing what was held for them. */
  async function track(/** @type {string[]} */ userIds, /** @type {WatchedPosition[]} */ positions) {
    await Promise.all([loadConfigs(userIds), ...userIds.map(loadBookedPnl)]);
    book.replaceUsers(userIds, positions);
  }

  /** Each user's automated P&L today: booked plus every watched position at its last price. */
  function todayPnlByUser() {
    const totals = openPnlByUser(book.values(), prices.last);
    for (const [userId, booked] of bookedPnlByUser) totals.set(userId, (totals.get(userId) ?? 0) + booked);
    return totals;
  }

  /** Cancel the waiting automated entry orders a rule says to, e.g. once the square-off time has come or the day's loss limit is hit. */
  async function cancelDueWaitingOrders(/** @type {import('../tradeMonitor.js').OrderService} */ orders) {
    const waiting = orders.waitingAutoOrders();
    if (waiting.length === 0) return;
    // Owners with waiting orders but no open position aren't tracked yet; their settings changes reload them (refreshUser).
    const untracked = [...new Set(waiting.map((order) => order.userId))].filter((userId) => !configsByUser.has(userId));
    if (untracked.length > 0) await loadConfigs(untracked);
    const state = { configsByUser, todayPnlByUser: todayPnlByUser(), now: clock() };
    await Promise.all(dueCancellations(waiting, state).map(async ({ order, reason }) => {
      const result = await orders.cancel(order.userId, order.id, cancelledByRule(reason));
      if (result.ok) log('order cancelled', { order: `${order.side} ${order.quantity} ${order.tradingsymbol}`, user: order.userId, reason });
    }));
  }

  return {
    source: TradeSource.Auto,
    positions: book.values,

    async loadAll() {
      const positions = await db.getAllOpenAutoPositions();
      book.clear();
      configsByUser.clear();
      bookedPnlByUser.clear();
      await track([...new Set(positions.map((p) => p.userId))], positions);
    },

    loadUser: async (/** @type {string} */ userId) => track([userId], await db.getOpenAutoPositions(userId)),

    dueExits: (/** @type {WatchedPosition[]} */ positions) => dueExits(positions, {
      lastPrices: prices.last, bestPrices: prices.best, configsByUser, todayPnlByUser: todayPnlByUser(), now: clock(),
    }),

    /** After the delete, so the exit is never counted as both open and booked. */
    async exited(/** @type {WatchedPosition} */ position) {
      book.delete(position.id);
      await loadBookedPnl(position.userId)
        .catch((err) => log("could not reload today's booked P&L", { user: position.userId, error: err.message }));
    },

    clockCheck: cancelDueWaitingOrders,

    /** The user's open automated P&L at the last prices (positions with no price yet count as 0). */
    openPnl: (/** @type {string} */ userId) => openPnlByUser(book.values(), prices.last).get(userId) ?? 0,

    clear() {
      book.clear();
      configsByUser.clear();
      bookedPnlByUser.clear();
    },
  };
}
