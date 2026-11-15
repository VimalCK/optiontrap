import { isMarketOpen, marketDate } from '../../../shared/marketTime.js';

/**
 * @typedef {import('./orders.js').Order} Order
 * @typedef {import('../../kiteTickerFeed.js').KiteSession} KiteSession
 */

/**
 * The order service's waiting orders, across all users, watched on live ticks from the server's shared Kite
 * ticker feed (admin session) in market hours. A tick that fills an order takes it off the watch first, so
 * it fills once.
 * @param {{
 *   findKiteSession: typeof import('../../oiHistoryScheduler.js').findWorkingAdminSession,
 *   createFeed: typeof import('../../sharedTickerFeed.js').openSharedTickerFeed,
 *   clock: () => Date,
 *   log: (message: string) => void,
 *   fillPrice: (order: Order, lastPrice: number, feedKite: KiteSession | null) => number | Promise<number> | null,
 *   fill: (order: Order, price: number) => Promise<unknown>,
 * }} deps
 *   fillPrice: what a waiting order fills at on a tick at `lastPrice`, or null when it doesn't fill.
 */
export function createOrderWatch({ findKiteSession, createFeed, clock, log, fillPrice, fill }) {
  /** @type {Map<number, Map<string, Order>>} instrument token → its waiting orders by id */
  const waiting = new Map();
  /** @type {ReturnType<typeof createFeed> | null} */
  let feed = null;
  /** The feed's Kite session, to quote market fills on ticks. @type {KiteSession | null} */
  let feedKite = null;
  /** Whether the engine runs the order service (it watches ticks only then); the day "no admin login" was logged. */
  let running = false;
  /** @type {string | null} */
  let waitingLoggedDate = null;

  const count = () => [...waiting.values()].reduce((n, orders) => n + orders.size, 0);
  const watchTokens = () => feed?.watch([...waiting.keys()]);

  function wait(/** @type {Order} */ order) {
    if (!waiting.has(order.instrumentToken)) waiting.set(order.instrumentToken, new Map());
    waiting.get(order.instrumentToken)?.set(order.id, order);
  }

  function unwait(/** @type {Order} */ order) {
    const orders = waiting.get(order.instrumentToken);
    if (!orders?.delete(order.id)) return false;
    if (orders.size === 0) waiting.delete(order.instrumentToken);
    watchTokens();
    return true;
  }

  function onTicks(/** @type {import('../../../shared/kiteTicks.js').Tick[]} */ ticks) {
    const fills = [];
    for (const tick of ticks) {
      for (const order of [...(waiting.get(tick.instrumentToken)?.values() ?? [])]) {
        const price = fillPrice(order, tick.lastPrice, feedKite);
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
    watchTokens();
  }

  return {
    count,
    onTicks,
    connected: () => feed !== null,
    ids: () => [...waiting.values()].flatMap((orders) => [...orders.keys()]),

    /** Watch a newly placed order. */
    add(/** @type {Order} */ order) {
      wait(order);
      watchTokens();
    },

    /** Stop watching an order (cancelled); false when it wasn't waiting. */
    remove: unwait,

    /** Watch exactly these orders, e.g. the open ones at the session's start. */
    replace(/** @type {Order[]} */ orders) {
      waiting.clear();
      for (const order of orders) wait(order);
    },

    /** Stop the feed and forget every order, e.g. after the close. */
    clear() {
      stopFeed();
      waiting.clear();
    },

    /** Start the feed if the service runs, orders are waiting and it isn't running (market hours only). */
    async ensureFeed() {
      if (running && !feed && count() > 0 && isMarketOpen(clock())) await startFeed();
    },

    start() {
      running = true;
    },

    stop() {
      running = false;
      stopFeed();
      waiting.clear();
    },
  };
}
