/**
 * The trade monitor service: watches every open paper position, manual and
 * automated, and exits it when its exit fires, on the live tick that crosses
 * it. A trade engine service (server/tradeEngine/host.js).
 *
 * Each source has its own channel (monitorChannels/), which loads its
 * positions and decides when they exit; the two never mix:
 * - automated (autoPositions.js): the owner's exit rules from their
 *   automation settings (shared/exitRules/);
 * - manual (manualPositions.js): the target, stop-loss and trailing stop-loss
 *   each position took from its order (the order popup).
 *
 * The monitor itself only runs them:
 * - On the market clock (ctx.market): at each open every channel loads its
 *   open positions, across all users; after the close it stops. One user's are
 *   loaded again when their positions or settings change: refreshUser, from
 *   the settings route and the signals service, and on every order the user
 *   fills by hand (a manual entry or exit).
 * - Prices come from the server's own Kite ticker feed (kiteTickerFeed.js,
 *   admin session, LTP mode, shared with the order service through
 *   sharedTickerFeed.js): one feed for all users, subscribed to exactly the
 *   instruments held. Each tick checks every position in that instrument.
 *   A check every second checks them on the last price too, so time-based
 *   exits fire on time even if an instrument goes quiet.
 * - It keeps each position's best price while watched, for the trailing
 *   stop-loss. In memory only: after a restart it starts again from the price then.
 * - An exit is an order through the order service (ctx.services.orders.exit):
 *   a market order filled at the bid / ask, with the exit's reason (which also
 *   closes the automated trades behind an automated position).
 */
import { NOT_FOUND } from '../positions.js';
import { openSharedTickerFeed } from '../../sharedTickerFeed.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { marketDate } from '../../../shared/marketTime.js';
import { betterPrice } from '../../../shared/trailingStop.js';
import { engineLogger } from '../../engineLog.js';
import { OrderStatus, TradeSource } from '../../../shared/tradeEnums.js';
import { HealthStatus } from '../../../shared/appEnums.js';
import { countLabel, healthTime } from '../../serviceHealth.js';
import { createAutoChannel } from './monitorChannels/autoPositions.js';
import { createManualChannel } from './monitorChannels/manualPositions.js';

/** This trade engine service's id: its key in ctx.services and on Admin Services. */
export const TRADE_MONITOR_SERVICE_ID = 'tradeMonitor';

/**
 * @typedef {{ marketOpen: boolean, feedConnected: boolean, waitingForLogin: boolean, watchedPositions: number,
 *             watchedInstruments: number, lastTickAt: number | null, lastError: string | null }} MonitorStatus
 * @typedef {{ id: string, userId: string, instrumentToken: number, tradingsymbol: string,
 *             side: import('../../../shared/tradeEnums.js').SideId, quantity: number, entryPrice: number,
 *             horizon: import('../../../shared/tradeEnums.js').HorizonId, strategyId?: string | null }} WatchedPosition
 *   strategyId: an automated position's strategy, whose exit rules it follows
 * @typedef {{ position: WatchedPosition, exitPrice: number, ruleId: string, reason: string }} DueExit
 * @typedef {{ last: Map<number, number>, best: Map<string, number> }} MonitorPrices
 *   last: instrument token → last traded price; best: position id → its best price while watched
 * @typedef {{
 *   source: import('../../../shared/tradeEnums.js').TradeSourceId,
 *   positions: () => WatchedPosition[],
 *   loadAll: () => Promise<void>,
 *   loadUser: (userId: string) => Promise<void>,
 *   dueExits: (positions: WatchedPosition[]) => DueExit[],
 *   exited: (position: WatchedPosition) => Promise<void>,
 *   clockCheck?: (orders: OrderService) => Promise<void>,
 *   clear: () => void,
 * }} MonitorChannel
 *   positions: what it watches; dueExits: which of these (its own) exit now, at their last prices;
 *   exited: a position is closed (or was closed elsewhere); clockCheck: its own every-second work
 * @typedef {ReturnType<typeof import('./orders.js').createOrderService>} OrderService
 */

/** A failing check, named as the trade monitor's within the engine's check. */
const monitorFailure = (/** @type {string} */ output) => ({ status: HealthStatus.Fail, output: `Trade monitor · ${output}`, time: null });

/**
 * The monitor's health from its status: fails when loading the open positions
 * failed, or when open positions go unwatched for want of an admin
 * Kite login; otherwise says what it is watching, timed at the last tick.
 * @param {MonitorStatus} status
 * @returns {import('../../serviceHealth.js').HealthCheck}
 */
export function monitorHealth(status) {
  if (status.lastError !== null) return monitorFailure(`Loading positions failed · ${status.lastError}`);
  if (!status.marketOpen) return { status: HealthStatus.Pass, output: 'Market closed · watches open positions in market hours', time: null };
  if (status.waitingForLogin) return monitorFailure(`${countLabel(status.watchedPositions, 'open position')} unwatched · no admin Kite login`);
  if (!status.feedConnected) return { status: HealthStatus.Pass, output: 'No open positions to watch', time: null };
  const watching = `Watching ${countLabel(status.watchedPositions, 'position')} in ${countLabel(status.watchedInstruments, 'instrument')}`;
  if (status.lastTickAt === null) return { status: HealthStatus.Pass, output: `${watching} · no tick yet`, time: null };
  return { status: HealthStatus.Pass, output: `${watching} · last tick`, time: healthTime(status.lastTickAt) };
}

/** How often every position is checked on its last price, for time-based exits. */
const CLOCK_CHECK_MS = 1000;
/** How often, in market hours, the feed is started if positions are watched and it isn't running (e.g. no admin login yet). */
const FEED_CHECK_MS = 60 * 1000;

/**
 * A trade monitor service. Everything it talks to is injectable, for tests;
 * the order service comes from the engine (ctx.services.orders); `db` holds
 * the channels' database functions (theirs when not given).
 * @param {{
 *   db?: Parameters<typeof createAutoChannel>[0]['db'] & Parameters<typeof createManualChannel>[0]['db'],
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   createFeed?: typeof openSharedTickerFeed,
 *   clock?: () => Date,
 *   log?: (event: string, details?: import('../../engineLog.js').EngineLogDetails) => void,
 * }} [deps]
 */
export function createTradeMonitor({
  db,
  findKiteSession = findWorkingAdminSession,
  createFeed = openSharedTickerFeed,
  clock = () => new Date(),
  log = engineLogger('Monitor'),
} = {}) {
  /** @type {MonitorPrices} */
  const prices = { last: new Map(), best: new Map() };
  const autoChannel = createAutoChannel({ db, prices, clock, log });
  /** @type {MonitorChannel[]} */
  const channels = [autoChannel, createManualChannel({ db, prices })];
  /** Positions being exited right now, so a burst of ticks exits each once. */
  const exiting = new Set();
  /** The order service exits go through, and the market clock (from the engine at start). */
  /** @type {OrderService} */
  let orders = /** @type {any} */ (null);
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

  const watchedPositions = () => channels.flatMap((channel) => channel.positions());
  const watchedTokens = () => [...new Set(watchedPositions().map((p) => p.instrumentToken))];

  /** Forget the best prices of positions no channel watches any more. */
  function pruneBestPrices() {
    const watched = new Set(watchedPositions().map((p) => p.id));
    for (const id of prices.best.keys()) if (!watched.has(id)) prices.best.delete(id);
  }

  /** Raise each position's best price to its last price where that is better. */
  function updateBestPrices(/** @type {WatchedPosition[]} */ positions) {
    for (const position of positions) {
      const price = prices.last.get(position.instrumentToken);
      if (price !== undefined) prices.best.set(position.id, betterPrice(position.side, prices.best.get(position.id), price));
    }
  }

  async function loadAll() {
    await Promise.all(channels.map((channel) => channel.loadAll()));
    prices.best.clear();
    log('loaded positions', Object.fromEntries(channels.map((channel) => [channel.source, channel.positions().length])));
  }

  /**
   * Exit one position at its due price through the order service, as the engine (source Auto, like the session
   * square-off), with the exit's reason; then its channel lets it go.
   * @param {MonitorChannel} channel
   * @param {DueExit} due
   */
  async function exit(channel, { position, exitPrice, ruleId, reason }) {
    if (exiting.has(position.id)) return;
    exiting.add(position.id);
    try {
      // A market exit: at the bid / ask from a quote with the feed's session (exitPrice when it has none).
      const result = await orders.exit(position.userId, position.id, { exitPrice, kite: feedKite, source: TradeSource.Auto, exitReason: { ruleId, reason } });
      if (result.ok) {
        log('exit fired', { position: `${position.side} ${position.quantity} ${position.tradingsymbol}`, source: channel.source, price: result.order.fillPrice, last: exitPrice, user: position.userId, reason });
      } else if (result.code !== NOT_FOUND) {
        log('could not exit', { position: position.tradingsymbol, user: position.userId, reason: result.message, next: 'tries again on the next tick' });
        return; // still open: the next tick or clock check tries again
      }
      prices.best.delete(position.id); // exited now, or already exited elsewhere
      await channel.exited(position);
      feed?.watch(watchedTokens());
    } catch (err) {
      log('exit failed', { position: position.tradingsymbol, user: position.userId, error: /** @type {Error} */ (err).message });
    } finally {
      exiting.delete(position.id);
    }
  }

  /** Check each channel's positions that pass `filter` at their last prices, and exit the ones due. */
  function check(/** @type {(position: WatchedPosition) => boolean} */ filter) {
    return Promise.all(channels.map((channel) => {
      const positions = channel.positions().filter(filter);
      updateBestPrices(positions);
      return Promise.all(channel.dueExits(positions).map((due) => exit(channel, due)));
    }));
  }

  /** The every-second check: time-based exits on positions with no new tick, and each channel's own work. */
  function clockCheck() {
    return Promise.all([feed ? check(() => true) : null, ...channels.map((channel) => channel.clockCheck?.(orders))]);
  }

  /** @param {import('../../../shared/kiteTicks.js').Tick[]} ticks */
  function onTicks(ticks) {
    if (ticks.length > 0) lastTickAt = clock().getTime();
    for (const tick of ticks) prices.last.set(tick.instrumentToken, tick.lastPrice);
    const tokens = new Set(ticks.map((t) => t.instrumentToken));
    return check((position) => tokens.has(position.instrumentToken));
  }

  function stopFeed() {
    feed?.close();
    feed = null;
    feedKite = null;
    waitingForLogin = false;
    prices.last.clear();
  }

  /** Start the feed while the session is loaded and positions are watched, if it isn't running (needs an admin login). */
  async function ensureFeed() {
    if (!loaded || feed || watchedPositions().length === 0) return;
    const kite = await findKiteSession();
    waitingForLogin = !kite;
    if (!kite) {
      const date = marketDate(clock());
      if (waitingLoggedDate !== date) log('waiting for an admin Kite login', { why: 'to watch open positions today' });
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

  /** At the open: every channel loads its open positions, then they are watched. */
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

  /** Reload one user's open positions in every channel (after a change). */
  async function refreshUser(/** @type {string} */ userId) {
    if (!loaded) return; // not watching yet: the open's load will include them
    await Promise.all(channels.map((channel) => channel.loadUser(userId)));
    pruneBestPrices();
    feed?.watch(watchedTokens());
    await ensureFeed();
  }

  /**
   * An order the user filled by hand opened, added to or closed a position (manual, or an automated one they
   * exited): reload theirs. The engine's own orders (source Auto) are its channels' business.
   */
  async function onOrderSettled(/** @type {{ userId: string, source: string, status: string }} */ order) {
    if (order.source === TradeSource.Manual && order.status === OrderStatus.Filled) await refreshUser(order.userId);
  }

  /** @returns {MonitorStatus} */
  function monitorStatus() {
    return {
      marketOpen: market?.isOpen() ?? false,
      feedConnected: feed !== null,
      waitingForLogin,
      watchedPositions: watchedPositions().length,
      watchedInstruments: watchedTokens().length,
      lastTickAt,
      lastError,
    };
  }

  /** After the close: stop watching until the next open. */
  function closeSession() {
    if (feed) log('market closed', { feed: 'stopped watching' });
    stopFeed();
    loaded = false;
  }

  return {
    id: TRADE_MONITOR_SERVICE_ID,

    /** Run on the market clock: watch from each open, check time-based exits every second, stop after the close. */
    start(/** @type {import('../host.js').PluginContext} */ ctx) {
      orders = ctx.services.orders;
      market = ctx.market;
      stopListening = orders.onSettled(onOrderSettled);
      ctx.market.onOpen(openSession);
      ctx.market.onClose(closeSession);
      ctx.market.every(CLOCK_CHECK_MS, clockCheck);
      ctx.market.every(FEED_CHECK_MS, ensureFeed);
    },

    stop() {
      stopListening();
      closeSession();
      for (const channel of channels) channel.clear();
      prices.best.clear();
    },

    onTicks,

    refreshUser,
    /** The user's open automated P&L at the last prices (positions with no price yet count as 0). */
    openPnl: autoChannel.openPnl,
    /** What is being watched, for tests and logs. */
    watchedPositionIds: () => watchedPositions().map((p) => p.id),
    /** How the monitor is doing, for Admin Services. */
    status: monitorStatus,

    /** Its own check for Admin Services, from its status. */
    health: () => monitorHealth(monitorStatus()),
  };
}
