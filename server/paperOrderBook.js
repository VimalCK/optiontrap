/**
 * The paper order book: places, fills and cancels paper limit orders
 * (the rules are in shared/paperOrders.js; orders are kept in paper_orders).
 *
 * - Placing checks the order as a paper trade, prices it from a quote with the
 *   user's own Kite session, and records it. An order that can fill at that
 *   price fills at once at it; otherwise it waits in the book.
 * - Waiting orders, across all users, are watched on live ticks from the
 *   server's shared Kite ticker feed (sharedTickerFeed.js, admin session, the
 *   one the trade monitor uses). The first tick that reaches an order's limit
 *   fills it at the limit.
 * - Orders are placed by hand (source manual) or by the trade engine for an
 *   automated trade (source auto, placeAuto: priced from the engine's own
 *   quote, linked to the trade).
 * - A fill opens the position through the one paper-trading path
 *   (paperTrading.js) with the order's source, so it merges and nets like any
 *   trade from that source. It is claimed in the database first, so an order
 *   fills once even when a cancel or another tick races it.
 * - Whenever an order fills or is cancelled (by the user, at the close, or
 *   because its trade was refused), listeners are told (onSettled): the trade
 *   engine moves an automated order's trade on through its lifecycle.
 * - At the market close every open order is cancelled (and, when the market
 *   opens, any left open from an earlier day); orders are loaded again from
 *   the database each market day.
 *
 * Every function returns a result instead of throwing for a refused order:
 *   { ok: true, order }               done
 *   { ok: false, code, message }      refused; code is a paper trade rule code
 *     (shared/paperTradeRules.js RULE_CODES), NO_PRICE or NOT_FOUND
 */
import {
  cancelOpenPaperOrdersPlacedBefore,
  cancelPaperOrder,
  cancelUnfilledPaperOrder,
  claimPaperOrderFill,
  createPaperOrder,
  getOpenPaperOrders,
  setPaperOrderPosition,
} from './db.js';
import { NOT_FOUND, openPaperTrade } from './paperTrading.js';
import { openSharedTickerFeed } from './sharedTickerFeed.js';
import { findWorkingAdminSession } from './oiHistoryScheduler.js';
import { fetchQuotes } from './kiteQuotes.js';
import { isMarketOpen } from './marketClock.js';
import { marketDate, marketDayStartMs } from '../shared/marketTime.js';
import { CANCELLED_AT_CLOSE, CANCELLED_BY_USER, canFill, parseLimitOrder } from '../shared/paperOrders.js';

export const NO_PRICE = 'NO_PRICE';
const NOT_OPEN_MESSAGE = 'Order not found or no longer open';
/** How often the market-open state is checked (watch at the open, cancel after the close). */
const MARKET_CHECK_MS = 60 * 1000;
const LOG_PREFIX = '[Order Book]';

/**
 * @typedef {Awaited<ReturnType<typeof createPaperOrder>>} PaperOrder
 * @typedef {{ ok: true, order: PaperOrder } | { ok: false, code: string, message: string }} OrderResult
 * @typedef {import('./kiteTickerFeed.js').KiteSession} KiteSession
 */

/**
 * An order book. Everything it talks to is injectable, for tests.
 * @param {{
 *   db?: { createPaperOrder: typeof createPaperOrder, getOpenPaperOrders: typeof getOpenPaperOrders,
 *          claimPaperOrderFill: typeof claimPaperOrderFill, setPaperOrderPosition: typeof setPaperOrderPosition,
 *          cancelUnfilledPaperOrder: typeof cancelUnfilledPaperOrder, cancelPaperOrder: typeof cancelPaperOrder,
 *          cancelOpenPaperOrdersPlacedBefore: typeof cancelOpenPaperOrdersPlacedBefore },
 *   openPosition?: typeof openPaperTrade,
 *   quotes?: typeof fetchQuotes,
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   createFeed?: typeof openSharedTickerFeed,
 *   clock?: () => Date,
 *   log?: (message: string) => void,
 * }} [deps]
 */
export function createPaperOrderBook({
  db = { createPaperOrder, getOpenPaperOrders, claimPaperOrderFill, setPaperOrderPosition, cancelUnfilledPaperOrder, cancelPaperOrder, cancelOpenPaperOrdersPlacedBefore },
  openPosition = openPaperTrade,
  quotes = fetchQuotes,
  findKiteSession = findWorkingAdminSession,
  createFeed = openSharedTickerFeed,
  clock = () => new Date(),
  log = (message) => console.log(`${LOG_PREFIX} ${message}`),
} = {}) {
  /** @type {Map<number, Map<string, PaperOrder>>} instrument token → its waiting orders by id */
  const waiting = new Map();
  /** @type {((order: PaperOrder) => Promise<void> | void)[]} */
  const settledListeners = [];
  /** @type {ReturnType<typeof openSharedTickerFeed> | null} */
  let feed = null;
  /** The market day orders were loaded for; whether the close has been handled; the day "no admin login" was logged. */
  let loadedDate = null;
  let closeHandled = false;
  let waitingLoggedDate = null;

  const waitingCount = () => [...waiting.values()].reduce((n, orders) => n + orders.size, 0);
  const watchWaiting = () => feed?.watch([...waiting.keys()]);

  function wait(/** @type {PaperOrder} */ order) {
    if (!waiting.has(order.instrumentToken)) waiting.set(order.instrumentToken, new Map());
    waiting.get(order.instrumentToken).set(order.id, order);
  }

  /** Take an order out of the book; returns whether it was waiting. */
  function unwait(/** @type {PaperOrder} */ order) {
    const orders = waiting.get(order.instrumentToken);
    if (!orders?.delete(order.id)) return false;
    if (orders.size === 0) waiting.delete(order.instrumentToken);
    watchWaiting();
    return true;
  }

  /** Tell every listener an order filled or was cancelled; a failing listener is logged, never thrown. */
  async function settled(/** @type {PaperOrder} */ order) {
    for (const listener of settledListeners) {
      try {
        await listener(order);
      } catch (err) {
        log(`${order.tradingsymbol} [${order.userId}] settle listener failed: ${/** @type {Error} */ (err).message}`);
      }
    }
  }

  /**
   * Fill an order at `price`: claim it, then open its position. A refused
   * trade (e.g. the market closed in between) cancels the order with why.
   * @param {PaperOrder} order
   * @param {number} price
   * @returns {Promise<PaperOrder>}
   */
  async function fill(order, price) {
    const claimed = await db.claimPaperOrderFill(order.id, price);
    if (!claimed) return order; // cancelled or filled meanwhile
    const opened = await openPosition(order.userId, { ...order, entryPrice: price }, { now: clock(), source: order.source });
    if (!opened.ok) {
      const cancelled = (await db.cancelUnfilledPaperOrder(order.id, opened.message))
        ?? { ...claimed, status: 'cancelled', statusReason: opened.message, fillPrice: null };
      log(`${order.tradingsymbol} [${order.userId}] could not fill: ${opened.message}`);
      await settled(cancelled);
      return cancelled;
    }
    await db.setPaperOrderPosition(order.id, opened.position.id);
    log(`${order.side} ${order.quantity} ${order.tradingsymbol} [${order.userId}] filled at ${price}`);
    const filled = { ...claimed, positionId: opened.position.id };
    await settled(filled);
    return filled;
  }

  /** Fill each waiting order these ticks reach, at its limit. */
  function onTicks(/** @type {import('../shared/kiteTicks.js').Tick[]} */ ticks) {
    const fills = [];
    for (const tick of ticks) {
      for (const order of [...(waiting.get(tick.instrumentToken)?.values() ?? [])]) {
        if (!canFill(order.side, order.limitPrice, tick.lastPrice) || !unwait(order)) continue;
        fills.push(fill(order, order.limitPrice).catch((err) => log(`${order.tradingsymbol} [${order.userId}] fill failed: ${err.message}`)));
      }
    }
    return Promise.all(fills);
  }

  function stopFeed() {
    feed?.close();
    feed = null;
  }

  async function startFeed() {
    const date = marketDate(clock());
    const kite = await findKiteSession();
    if (!kite) {
      if (waitingLoggedDate !== date) log('waiting for an admin Kite login today to watch limit orders');
      waitingLoggedDate = date;
      return;
    }
    feed = createFeed({
      kite,
      onTicks: (ticks) => { onTicks(ticks); },
      onAuthError: () => { log('the admin Kite session expired; trying again at the next check'); stopFeed(); },
    });
    watchWaiting();
  }

  /** Start the feed if orders are waiting and it isn't running (market hours only). */
  async function ensureFeed() {
    if (!feed && waitingCount() > 0 && isMarketOpen(clock())) await startFeed();
  }

  /** After the close: cancel every open order and stop watching (once per close). */
  async function handleClose(/** @type {Date} */ now) {
    stopFeed();
    if (closeHandled) return;
    waiting.clear();
    const cancelled = await db.cancelOpenPaperOrdersPlacedBefore(now.toISOString(), CANCELLED_AT_CLOSE);
    if (cancelled.length > 0) log(`market closed; cancelled ${cancelled.length} open order(s)`);
    closeHandled = true;
    for (const order of cancelled) await settled(order);
  }

  /** Once per market day: cancel orders left from an earlier day, then load today's open ones. */
  async function loadDay(/** @type {Date} */ now) {
    const todayStart = new Date(marketDayStartMs(now.getTime())).toISOString();
    for (const order of await db.cancelOpenPaperOrdersPlacedBefore(todayStart, CANCELLED_AT_CLOSE)) await settled(order);
    waiting.clear();
    for (const order of await db.getOpenPaperOrders(todayStart)) wait(order);
    log(`watching ${waitingCount()} open order(s)`);
  }

  /**
   * Record a parsed order and fill it at once at `lastPrice` when it can fill
   * there; otherwise leave it waiting in the book.
   * @param {string} userId
   * @param {import('../shared/paperOrders.js').LimitOrder} limitOrder
   * @param {number} lastPrice
   * @param {Parameters<typeof createPaperOrder>[2]} placedBy
   * @returns {Promise<OrderResult>}
   */
  async function enter(userId, limitOrder, lastPrice, placedBy) {
    const order = await db.createPaperOrder(userId, limitOrder, placedBy);
    if (canFill(order.side, order.limitPrice, lastPrice)) return { ok: true, order: await fill(order, lastPrice) };
    wait(order);
    watchWaiting();
    await ensureFeed();
    return { ok: true, order };
  }

  return {
    onTicks,

    /** Watch at the market open (loading orders once a day); cancel open orders after the close. */
    async checkMarket() {
      const now = clock();
      if (!isMarketOpen(now)) return handleClose(now);
      closeHandled = false;
      const date = marketDate(now);
      if (loadedDate !== date) {
        await loadDay(now);
        loadedDate = date;
      }
      await ensureFeed();
    },

    /**
     * Place a limit order for the user: filled at once at the last price when
     * it can fill there, otherwise left open in the book.
     * @param {string} userId
     * @param {Record<string, unknown>} input
     * @param {KiteSession} kite  the user's own session, for the quote
     * @returns {Promise<OrderResult>}
     */
    async place(userId, input, kite) {
      const parsed = parseLimitOrder(input, { now: clock() });
      if (parsed.error !== undefined) return { ok: false, code: parsed.code, message: parsed.error };
      const { order: limitOrder } = parsed;
      const key = `${limitOrder.exchange}:${limitOrder.tradingsymbol}`;
      const lastPrice = (await quotes(kite, [key]))[key]?.last_price;
      if (!lastPrice) return { ok: false, code: NO_PRICE, message: `No last price for ${limitOrder.tradingsymbol}` };
      return enter(userId, limitOrder, lastPrice, { source: 'manual' });
    },

    /**
     * Place a limit order for one of the user's automated trades, at the
     * last price the trade engine quoted; its fill opens an automated
     * position, and listeners are told when it fills or is cancelled.
     * @param {string} userId
     * @param {Record<string, unknown>} input
     * @param {{ lastPrice: number, autoTradeId: string }} placement
     * @returns {Promise<OrderResult>}
     */
    async placeAuto(userId, input, { lastPrice, autoTradeId }) {
      const parsed = parseLimitOrder(input, { now: clock() });
      if (parsed.error !== undefined) return { ok: false, code: parsed.code, message: parsed.error };
      return enter(userId, parsed.order, lastPrice, { source: 'auto', autoTradeId });
    },

    /**
     * Cancel one of the user's open orders.
     * @param {string} userId
     * @param {string} id
     * @returns {Promise<OrderResult>}
     */
    async cancel(userId, id) {
      const cancelled = await db.cancelPaperOrder(userId, id, CANCELLED_BY_USER);
      if (!cancelled) return { ok: false, code: NOT_FOUND, message: NOT_OPEN_MESSAGE };
      unwait(cancelled);
      await settled(cancelled);
      return { ok: true, order: cancelled };
    },

    /** Be told whenever an order fills or is cancelled; a listener's error is logged, never thrown. */
    onSettled(/** @type {(order: PaperOrder) => Promise<void> | void} */ listener) {
      settledListeners.push(listener);
    },

    /** The ids of the orders waiting, for tests and logs. */
    waitingOrderIds: () => [...waiting.values()].flatMap((orders) => [...orders.keys()]),
  };
}

const book = createPaperOrderBook();

/** Place a limit order for the user (POST /api/paper-orders). */
export const placeLimitOrder = book.place;
/** Cancel one of the user's open limit orders (PATCH /api/paper-orders/:id). */
export const cancelLimitOrder = book.cancel;
/** Place a limit order for an automated trade (the trade engine, with Entry limit offset on). */
export const placeAutoLimitOrder = book.placeAuto;
/** Be told whenever a limit order fills or is cancelled (the trade engine, for automated orders). */
export const onPaperOrderSettled = book.onSettled;

/** Start the book: the market check now and every minute (a failed check is logged, never thrown). */
export function startPaperOrderBook() {
  const checkMarket = () => book.checkMarket().catch((err) => console.warn(`${LOG_PREFIX} market check failed:`, err.message));
  checkMarket();
  setInterval(checkMarket, MARKET_CHECK_MS).unref();
}
