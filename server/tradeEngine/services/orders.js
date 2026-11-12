/**
 * The order service: the one path for every trade, a trade engine service
 * (server/tradeEngine/host.js). Manual orders (POST /api/orders) and the
 * engine's own (the signals service's entries, the trade monitor's exits) are
 * placed, filled and cancelled here; the rules are in shared/paperOrders.js
 * and shared/paperTradeRules.js, orders are kept in the orders table.
 *
 * - Placing checks the order, prices it from a quote, and records it. In
 *   market hours a market order fills at once at the bid / ask
 *   (fillPrice.js), and a limit order that can fill at the last price fills at
 *   once at it; otherwise the order waits. Outside market hours (positional
 *   orders only) it always waits: orders fill only while the market is open.
 * - Waiting orders, across all users, are watched on live ticks from the
 *   server's shared Kite ticker feed (sharedTickerFeed.js, admin session, the
 *   one the trade monitor uses), in market hours. The first tick that reaches
 *   a limit order's limit fills it at the limit; a waiting market order fills
 *   on its first tick, at the bid / ask (the tick's last price when the quote
 *   has none).
 * - A fill opens or adds to the position (positions.js) with the order's
 *   source, so it merges like any trade from that source. It is claimed in the
 *   database first, so an order fills once even when a cancel or a tick races it.
 * - An exit is an order too: it closes the whole position at the bid / ask at
 *   once (market hours only), and is recorded as a filled closing order. So is
 *   the engine's square-off after the close (squareOff), at the closing price.
 * - Whenever an order fills or is cancelled (by the user, at the close, or
 *   because its trade was refused), listeners are told (onSettled): the
 *   signals service moves an automated order's trade on through its lifecycle.
 * - The market clock (ctx.market) runs it: at each open it cancels any order
 *   left from an earlier session and watches the ones placed since it ended;
 *   after each close it cancels every open order placed during the session.
 *   Orders placed after the close wait for the next session.
 *
 * Every function returns a result instead of throwing for a refused order:
 *   { ok: true, order }               done (an exit also gives the closed position)
 *   { ok: false, code, message }      refused; code is a paper trade rule code
 *     (shared/paperTradeRules.js RULE_CODES), NO_PRICE or NOT_FOUND
 */
import {
  cancelOpenOrdersPlacedBefore,
  cancelOrder,
  cancelUnfilledOrder,
  claimOrderFill,
  createOrder,
  getOpenOrders,
  recordClosingOrder,
  setOrderPosition,
} from '../../db.js';
import { NOT_FOUND, MANUAL_EXIT, closablePosition, closePosition, openPosition, squareOffable } from '../positions.js';
import { openSharedTickerFeed } from '../../sharedTickerFeed.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { fetchQuotes } from '../../kiteQuotes.js';
import { isMarketOpen, lastSessionEnd, marketDate } from '../../../shared/marketTime.js';
import { normalizeTradeInput } from '../../../shared/paperTradeRules.js';
import { CANCELLED_AT_CLOSE, CANCELLED_BY_USER, canFill, parseOrder } from '../../../shared/paperOrders.js';
import { quotedFillPrice } from '../fillPrice.js';
import { OrderStatus, OrderType, Side, TradeSource, oppositeSide } from '../../../shared/tradeEnums.js';

export const NO_PRICE = 'NO_PRICE';
const NOT_OPEN_MESSAGE = 'Order not found or no longer open';
/** How often, in market hours, the feed is started if orders wait and it isn't running (e.g. no admin login yet). */
const FEED_CHECK_MS = 60 * 1000;
const LOG_PREFIX = '[Orders]';

/**
 * @typedef {Awaited<ReturnType<typeof createOrder>>} Order
 * @typedef {{ ok: true, order: Order, position?: any } | { ok: false, code: string, message: string }} OrderResult
 * @typedef {import('../../kiteTickerFeed.js').KiteSession} KiteSession
 * @typedef {{ kite?: KiteSession | null, fill?: number | null }} PriceSource
 *   where a market fill's price comes from: a quote with `kite`, or `fill` already quoted
 */

/**
 * An order service. Everything it talks to is injectable, for tests.
 * @param {{
 *   db?: { createOrder: typeof createOrder, getOpenOrders: typeof getOpenOrders,
 *          claimOrderFill: typeof claimOrderFill, setOrderPosition: typeof setOrderPosition,
 *          cancelUnfilledOrder: typeof cancelUnfilledOrder, cancelOrder: typeof cancelOrder,
 *          cancelOpenOrdersPlacedBefore: typeof cancelOpenOrdersPlacedBefore, recordClosingOrder: typeof recordClosingOrder },
 *   positions?: { openPosition: typeof openPosition, closablePosition: typeof closablePosition, closePosition: typeof closePosition,
 *                 squareOffable: typeof squareOffable },
 *   quotes?: typeof fetchQuotes,
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   createFeed?: typeof openSharedTickerFeed,
 *   clock?: () => Date,
 *   log?: (message: string) => void,
 * }} [deps]
 */
export function createOrderService({
  db = { createOrder, getOpenOrders, claimOrderFill, setOrderPosition, cancelUnfilledOrder, cancelOrder, cancelOpenOrdersPlacedBefore, recordClosingOrder },
  positions = { openPosition, closablePosition, closePosition, squareOffable },
  quotes = fetchQuotes,
  findKiteSession = findWorkingAdminSession,
  createFeed = openSharedTickerFeed,
  clock = () => new Date(),
  log = (message) => console.log(`${LOG_PREFIX} ${message}`),
} = {}) {
  /** @type {Map<number, Map<string, Order>>} instrument token → its waiting orders by id */
  const waiting = new Map();
  /** @type {((order: Order) => Promise<void> | void)[]} */
  const settledListeners = [];
  /** @type {ReturnType<typeof openSharedTickerFeed> | null} */
  let feed = null;
  /** The feed's Kite session, to quote market fills on ticks. @type {KiteSession | null} */
  let feedKite = null;
  /** Whether the engine runs this service (it watches ticks only then); the day "no admin login" was logged. */
  let started = false;
  let waitingLoggedDate = null;

  const waitingCount = () => [...waiting.values()].reduce((n, orders) => n + orders.size, 0);
  const watchWaiting = () => feed?.watch([...waiting.keys()]);

  function wait(/** @type {Order} */ order) {
    if (!waiting.has(order.instrumentToken)) waiting.set(order.instrumentToken, new Map());
    waiting.get(order.instrumentToken).set(order.id, order);
  }

  /** Take an order out of the waiting list; returns whether it was waiting. */
  function unwait(/** @type {Order} */ order) {
    const orders = waiting.get(order.instrumentToken);
    if (!orders?.delete(order.id)) return false;
    if (orders.size === 0) waiting.delete(order.instrumentToken);
    watchWaiting();
    return true;
  }

  /** Tell every listener an order filled or was cancelled; a failing listener is logged, never thrown. */
  async function settled(/** @type {Order} */ order) {
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
   * @param {Order} order
   * @param {number} price
   * @returns {Promise<Order>}
   */
  async function fill(order, price) {
    const claimed = await db.claimOrderFill(order.id, price);
    if (!claimed) return order; // cancelled or filled meanwhile
    const opened = await positions.openPosition(order.userId, { ...order, entryPrice: price }, { now: clock(), source: order.source });
    if (!opened.ok) {
      const cancelled = (await db.cancelUnfilledOrder(order.id, opened.message))
        ?? { ...claimed, status: OrderStatus.Cancelled, statusReason: opened.message, fillPrice: null };
      log(`${order.tradingsymbol} [${order.userId}] could not fill: ${opened.message}`);
      await settled(cancelled);
      return cancelled;
    }
    await db.setOrderPosition(order.id, opened.position.id);
    log(`${order.side} ${order.quantity} ${order.tradingsymbol} [${order.userId}] filled at ${price}`);
    const filled = { ...claimed, positionId: opened.position.id };
    await settled(filled);
    return filled;
  }

  /**
   * The market fill for a trade: the bid / ask already quoted (`source.fill`)
   * or from a quote with `source.kite`; `lastPrice` when neither gives one.
   * @param {{ userId?: string, exchange: string, tradingsymbol: string, side: import('../../../shared/tradeEnums.js').SideId }} trade
   * @param {number} lastPrice
   * @param {PriceSource} source
   */
  async function marketPrice(trade, lastPrice, { kite, fill: quoted } = {}) {
    if (quoted) return quoted;
    if (!kite) return lastPrice;
    try {
      return (await quotedFillPrice(kite, trade, trade.side, quotes)) ?? lastPrice;
    } catch (err) {
      log(`${trade.tradingsymbol} [${trade.userId}] no quote, filling at ${lastPrice}: ${/** @type {Error} */ (err).message}`);
      return lastPrice;
    }
  }

  /**
   * The price a waiting order fills at on a tick at `lastPrice`: a market
   * order at the market, a limit order at its limit once the tick reaches it;
   * null when it doesn't fill.
   * @param {Order} order
   * @param {number} lastPrice
   * @returns {number | Promise<number> | null}
   */
  function tickFillPrice(order, lastPrice) {
    if (order.orderType === OrderType.Market) return marketPrice(order, lastPrice, { kite: feedKite });
    return canFill(order.side, /** @type {number} */ (order.limitPrice), lastPrice) ? order.limitPrice : null;
  }

  /** Fill each waiting order these ticks reach: a market order on its first tick, a limit order at its limit. */
  function onTicks(/** @type {import('../../../shared/kiteTicks.js').Tick[]} */ ticks) {
    const fills = [];
    for (const tick of ticks) {
      for (const order of [...(waiting.get(tick.instrumentToken)?.values() ?? [])]) {
        const price = tickFillPrice(order, tick.lastPrice);
        if (price === null || !unwait(order)) continue;
        fills.push(Promise.resolve(price).then((at) => fill(order, at))
          .catch((err) => log(`${order.tradingsymbol} [${order.userId}] fill failed: ${err.message}`)));
      }
    }
    return Promise.all(fills);
  }

  function stopFeed() {
    feed?.close();
    feed = null;
    feedKite = null;
  }

  async function startFeed() {
    const date = marketDate(clock());
    const kite = await findKiteSession();
    if (!kite) {
      if (waitingLoggedDate !== date) log('waiting for an admin Kite login today to watch open orders');
      waitingLoggedDate = date;
      return;
    }
    feed = createFeed({
      kite,
      onTicks: (ticks) => { onTicks(ticks); },
      onAuthError: () => { log('the admin Kite session expired; trying again at the next check'); stopFeed(); },
    });
    feedKite = kite;
    watchWaiting();
  }

  /** Start the feed if the service runs, orders are waiting and it isn't running (market hours only). */
  async function ensureFeed() {
    if (started && !feed && waitingCount() > 0 && isMarketOpen(clock())) await startFeed();
  }

  /**
   * At the open: cancel orders left open from an earlier session, then watch
   * the open ones placed since it ended (after its close, or today).
   */
  async function openSession() {
    const since = lastSessionEnd(clock()).toISOString();
    for (const order of await db.cancelOpenOrdersPlacedBefore(since, CANCELLED_AT_CLOSE)) await settled(order);
    waiting.clear();
    for (const order of await db.getOpenOrders(since)) wait(order);
    log(`watching ${waitingCount()} open order(s)`);
    await ensureFeed();
  }

  /**
   * After the close: stop watching and cancel every open order placed during
   * the session. Orders placed since wait for the next one.
   */
  async function closeSession() {
    stopFeed();
    waiting.clear();
    const cancelled = await db.cancelOpenOrdersPlacedBefore(lastSessionEnd(clock()).toISOString(), CANCELLED_AT_CLOSE);
    if (cancelled.length > 0) log(`market closed; cancelled ${cancelled.length} open order(s)`);
    for (const order of cancelled) await settled(order);
  }

  /**
   * The price an order fills at as it is placed, or null when it waits: in
   * market hours a market order at the market, a limit order at the last price
   * when it can fill there; outside market hours none.
   * @param {Order} order
   * @param {number} lastPrice
   * @param {PriceSource} source
   */
  async function placedFillPrice(order, lastPrice, source) {
    if (!isMarketOpen(clock())) return null;
    if (order.orderType === OrderType.Market) return marketPrice(order, lastPrice, source);
    return canFill(order.side, /** @type {number} */ (order.limitPrice), lastPrice) ? lastPrice : null;
  }

  /**
   * Record a parsed order and fill it at once when it can fill now;
   * otherwise leave it waiting.
   * @param {string} userId
   * @param {import('../../../shared/paperOrders.js').Order} parsed
   * @param {number} lastPrice
   * @param {Parameters<typeof createOrder>[2]} placedBy
   * @param {PriceSource} source
   * @returns {Promise<OrderResult>}
   */
  async function enter(userId, parsed, lastPrice, placedBy, source) {
    const order = await db.createOrder(userId, parsed, placedBy);
    const price = await placedFillPrice(order, lastPrice, source);
    if (price !== null) return { ok: true, order: await fill(order, price) };
    wait(order);
    watchWaiting();
    await ensureFeed();
    return { ok: true, order };
  }

  return {
    id: 'orders',

    /** Run on the market clock: watch at each open, cancel the session's open orders after each close. */
    start(/** @type {import('../host.js').PluginContext} */ ctx) {
      started = true;
      ctx.market.onOpen(openSession);
      ctx.market.onClose(closeSession);
      ctx.market.every(FEED_CHECK_MS, ensureFeed);
    },

    stop() {
      started = false;
      stopFeed();
      waiting.clear();
    },

    status: () => ({ waitingOrders: waitingCount(), feedConnected: feed !== null }),

    onTicks,

    /**
     * Place a limit or market order for the user: filled at once when it can
     * fill now (market hours only), otherwise left open.
     * @param {string} userId
     * @param {Record<string, unknown>} input
     * @param {KiteSession} kite  the user's own session, for the quotes
     * @returns {Promise<OrderResult>}
     */
    async place(userId, input, kite) {
      // A market order's checks need the last price; anything else is checked
      // before quoting, so a failing quote can't hide why it was refused.
      const checkedFirst = input.orderType === OrderType.Market ? null : parseOrder(input, { now: clock() });
      if (checkedFirst?.error !== undefined) return { ok: false, code: checkedFirst.code, message: checkedFirst.error };
      const { exchange, tradingsymbol } = normalizeTradeInput(input);
      let lastPrice;
      if (tradingsymbol) {
        const key = `${exchange}:${tradingsymbol}`;
        lastPrice = (await quotes(kite, [key]))[key]?.last_price;
        if (!lastPrice) return { ok: false, code: NO_PRICE, message: `No last price for ${tradingsymbol}` };
      }
      const parsed = checkedFirst ?? parseOrder(input, { now: clock(), lastPrice });
      if (parsed.error !== undefined) return { ok: false, code: parsed.code, message: parsed.error };
      return enter(userId, parsed.order, /** @type {number} */ (lastPrice), { source: TradeSource.Manual }, { kite });
    },

    /**
     * Place an order for one of the user's automated trades, priced from the
     * engine's own quote: a market order fills at `fillPrice` (the bid / ask,
     * else the last price), a limit order at its limit. Its fill opens an
     * automated position, and listeners are told when it fills or is cancelled.
     * @param {string} userId
     * @param {Record<string, unknown>} input  the trade, with orderType and, for a limit order, limitPrice
     * @param {{ lastPrice: number, fillPrice?: number | null, autoTradeId: string }} placement
     * @returns {Promise<OrderResult>}
     */
    async placeAuto(userId, input, { lastPrice, fillPrice = null, autoTradeId }) {
      const parsed = parseOrder(input, { now: clock(), lastPrice });
      if (parsed.error !== undefined) return { ok: false, code: parsed.code, message: parsed.error };
      return enter(userId, parsed.order, lastPrice, { source: TradeSource.Auto, autoTradeId }, { fill: fillPrice });
    },

    /**
     * Exit one of the user's open positions: a market order for the whole
     * quantity on the other side, filled at once at the bid / ask (quoted with
     * `kite`; `exitPrice`, the last price, when there is no bid / ask). Market
     * hours only, for a paper position.
     * @param {string} userId
     * @param {string} positionId
     * @param {{ exitPrice: unknown, kite?: KiteSession | null, source?: import('../../../shared/tradeEnums.js').TradeSourceId,
     *   exitReason?: { ruleId: string | null, reason: string } }} exit
     *   source: who exits it, by hand or an exit rule. exitReason: recorded on an automated position's trades.
     * @returns {Promise<OrderResult>}
     */
    async exit(userId, positionId, { exitPrice, kite = null, source = TradeSource.Manual, exitReason = MANUAL_EXIT }) {
      const now = clock();
      const checked = await positions.closablePosition(userId, positionId, exitPrice, now);
      if (!checked.ok) return checked;
      const { position } = checked;
      const side = oppositeSide(position.side);
      const price = await marketPrice({ ...position, side }, Number(exitPrice), { kite });
      const closed = await positions.closePosition(userId, position, price, { now, exitReason });
      if (!closed.ok) return closed;
      const order = await db.recordClosingOrder(userId, position, price, source);
      await settled(order);
      return { ok: true, order, position: closed.position };
    },

    /**
     * Square off an open position after the market closed: the engine's own
     * exit, at `price` (its last price after the close) dated `at` (the
     * session's end), recorded as a filled closing order (source auto).
     * Checked as a 'square-off', which the market-open rule doesn't cover.
     * @param {any} position  the open position, with its userId
     * @param {{ price: number, at: Date, exitReason: { ruleId: string | null, reason: string } }} squareOff
     * @returns {Promise<OrderResult>}
     */
    async squareOff(position, { price, at, exitReason }) {
      const checked = positions.squareOffable(position, price, at);
      if (!checked.ok) return checked;
      const closed = await positions.closePosition(position.userId, position, price, { now: at, exitReason });
      if (!closed.ok) return closed;
      const order = await db.recordClosingOrder(position.userId, position, price, TradeSource.Auto);
      await settled(order);
      return { ok: true, order, position: closed.position };
    },

    /**
     * Cancel one of the user's open orders.
     * @param {string} userId
     * @param {string} id
     * @returns {Promise<OrderResult>}
     */
    async cancel(userId, id) {
      const cancelled = await db.cancelOrder(userId, id, CANCELLED_BY_USER);
      if (!cancelled) return { ok: false, code: NOT_FOUND, message: NOT_OPEN_MESSAGE };
      unwait(cancelled);
      await settled(cancelled);
      return { ok: true, order: cancelled };
    },

    /**
     * Be told whenever an order fills or is cancelled; a listener's error is
     * logged, never thrown. Returns a function that stops telling it.
     */
    onSettled(/** @type {(order: Order) => Promise<void> | void} */ listener) {
      settledListeners.push(listener);
      return () => {
        const index = settledListeners.indexOf(listener);
        if (index !== -1) settledListeners.splice(index, 1);
      };
    },

    /** The ids of the orders waiting, for tests and logs. */
    waitingOrderIds: () => [...waiting.values()].flatMap((orders) => [...orders.keys()]),
  };
}
