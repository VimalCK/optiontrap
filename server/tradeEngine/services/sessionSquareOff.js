/**
 * The session square-off service: no intraday position outlives its session,
 * whoever opened it (manual or automated) and whether or not the server was
 * running at the close. A trade engine service (server/tradeEngine/host.js).
 *
 * - After each close, and at startup while the market is closed (the market
 *   clock reports that as a close), it squares off every open intraday paper
 *   position opened before the session ended. The price is its last traded
 *   price after the close (quoted with the admin Kite session), the exit time
 *   the session's end, through the order service (orders.squareOff).
 * - While the market is open (first at the open, so also at a startup in
 *   market hours) it exits any left from an earlier session as an ordinary
 *   exit at the bid / ask (orders.exit): the server was down through the
 *   close, or there was no admin login or no quote after it. It looks again
 *   every LEFTOVER_CHECK_MS, so a position it couldn't price is picked up once
 *   the admin logs in.
 * Users' own "Square off at" exit rule (the trade monitor) still closes
 * automated positions earlier in the day; this is the backstop.
 */
import { getOpenIntradayPositionsBefore } from '../../db.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { fetchQuotes } from '../../kiteQuotes.js';
import { lastSessionEnd } from '../../../shared/marketTime.js';
import { NOT_FOUND, SESSION_SQUARE_OFF } from '../positions.js';
import { TradeSource } from '../../../shared/tradeEnums.js';

/** This trade engine service's id: its key in ctx.services and on Admin Services. */
export const SESSION_SQUARE_OFF_SERVICE_ID = 'sessionSquareOff';

/** How often, in market hours, positions left from an earlier session are looked for (first at the open). */
const LEFTOVER_CHECK_MS = 60_000;

/**
 * @typedef {Awaited<ReturnType<typeof getOpenIntradayPositionsBefore>>[number]} OpenPosition
 * @typedef {{ ok: boolean, code?: string, message?: string }} CloseResult
 * @typedef {{ at: number, when: string, found: number, closed: number }} SquareOffRun
 */

/** The quote API key of a position's instrument, e.g. NFO:NIFTY26NOV24000CE. */
const quoteKey = (/** @type {OpenPosition} */ position) => `${position.exchange}:${position.tradingsymbol}`;

/**
 * A session square-off service. Everything it talks to is injectable, for tests.
 * @param {{
 *   db?: { getOpenIntradayPositionsBefore: typeof getOpenIntradayPositionsBefore },
 *   quotes?: typeof fetchQuotes,
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   clock?: () => Date,
 * }} [deps]
 */
export function createSessionSquareOff({
  db = { getOpenIntradayPositionsBefore },
  quotes = fetchQuotes,
  findKiteSession = findWorkingAdminSession,
  clock = () => new Date(),
} = {}) {
  /** The order service and the engine's log for this service (from the engine at start). */
  let orders = null;
  /** @type {import('../host.js').PluginContext['log']} */
  let log = () => {};
  /** Positions already logged as having no price, so the minutely check doesn't repeat it. */
  const loggedNoPrice = new Set();
  /** @type {SquareOffRun | null} */
  let lastRun = null;

  /** Open intraday positions from sessions that have ended, with the admin session and their last prices. */
  async function leftovers() {
    const sessionEnd = lastSessionEnd(clock());
    const positions = await db.getOpenIntradayPositionsBefore(sessionEnd.toISOString());
    if (positions.length === 0) return { sessionEnd, positions, kite: null, prices: {} };
    const kite = await findKiteSession();
    if (!kite) {
      log('no admin Kite login to price them', { open: positions.length, next: 'trying again in market hours' });
      return { sessionEnd, positions: [], kite: null, prices: {} };
    }
    const quoted = await quotes(kite, [...new Set(positions.map(quoteKey))]);
    /** @type {Record<string, number | undefined>} */
    const prices = Object.fromEntries(Object.entries(quoted).map(([key, quote]) => [key, quote?.last_price]));
    return { sessionEnd, positions, kite, prices };
  }

  /**
   * Close each position that has a last price, `close` deciding how; how many closed.
   * @param {OpenPosition[]} positions
   * @param {Record<string, number | undefined>} prices
   * @param {(position: OpenPosition, price: number) => Promise<CloseResult>} close
   */
  async function closeEach(positions, prices, close) {
    let closed = 0;
    for (const position of positions) {
      const price = prices[quoteKey(position)];
      if (!price) {
        if (!loggedNoPrice.has(position.id)) log('no last price', { position: position.id, symbol: position.tradingsymbol });
        loggedNoPrice.add(position.id);
        continue;
      }
      const result = await close(position, price);
      if (result.ok) closed += 1;
      else if (result.code !== NOT_FOUND) log('could not square off', { position: position.id, reason: result.message ?? result.code ?? '' });
    }
    return closed;
  }

  function report(/** @type {string} */ when, /** @type {number} */ found, /** @type {number} */ closed) {
    lastRun = { at: clock().getTime(), when, found, closed };
    log('squared off', { when, found, closed, left: found - closed });
  }

  /** After a close: square off what the ended session left open, at its closing prices. */
  async function squareOffEndedSession() {
    const { sessionEnd, positions, prices } = await leftovers();
    if (positions.length === 0) return;
    const closed = await closeEach(positions, prices, (position, price) =>
      orders.squareOff(position, { price, at: sessionEnd, exitReason: SESSION_SQUARE_OFF }));
    report('after the close', positions.length, closed);
  }

  /** In market hours: exit, at the bid / ask, intraday positions left from an earlier session. */
  async function exitLeftovers() {
    const { positions, kite, prices } = await leftovers();
    if (positions.length === 0) return;
    const closed = await closeEach(positions, prices, (position, price) =>
      orders.exit(position.userId, position.id, { exitPrice: price, kite, source: TradeSource.Auto, exitReason: SESSION_SQUARE_OFF }));
    report('in market hours', positions.length, closed);
  }

  return {
    id: SESSION_SQUARE_OFF_SERVICE_ID,

    /** Run on the market clock: square off after each close, and pick up leftovers while the market is open. */
    start(/** @type {import('../host.js').PluginContext} */ ctx) {
      orders = ctx.services.orders;
      log = ctx.log;
      ctx.market.onClose(squareOffEndedSession);
      ctx.market.every(LEFTOVER_CHECK_MS, exitLeftovers);
    },

    /** The last square-off, for Admin Services. */
    status: () => ({ lastRun }),
  };
}
