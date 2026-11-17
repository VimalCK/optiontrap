/**
 * The session square-off service: no intraday position outlives its session,
 * whoever opened it (manual or automated) and whether or not the server was
 * running at the close. A trade engine service (server/tradeEngine/host.js).
 *
 * Every open intraday paper position from a session that has ended is closed
 * at that session's closing price, dated at its end, through the order service
 * (orders.squareOff), so its P&L lands on its own day:
 * - After each close, and at startup while the market is closed (the market
 *   clock reports that as a close). A position from the session that just
 *   ended is priced at its last traded price after the close.
 * - While the market is open, every LEFTOVER_CHECK_MS (first at the open, so
 *   also at a startup in market hours): the server was down through the close,
 *   or there was no admin login then.
 * A position from an earlier session (the server was down over a close) is
 * priced at the close of that day's candle. Prices come with the admin Kite
 * login; without one nothing closes, and the next check tries again.
 * Users' own "Square off at" exit rule (the trade monitor) still closes
 * automated positions earlier in the day; this is the backstop.
 */
import { getOpenIntradayPositionsBefore } from '../../db.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { fetchQuotes } from '../../kiteQuotes.js';
import { fetchDayCandles } from '../../kiteCandles.js';
import { isMarketOpen, lastSessionEnd, marketDate, sessionEnd } from '../../../shared/marketTime.js';
import { NOT_FOUND, SESSION_SQUARE_OFF } from '../positions.js';

/** This trade engine service's id: its key in ctx.services and on Admin Services. */
export const SESSION_SQUARE_OFF_SERVICE_ID = 'sessionSquareOff';

/** How often, in market hours, positions left from an earlier session are looked for (first at the open). */
const LEFTOVER_CHECK_MS = 60_000;

/** A Kite candle row: [time, open, high, low, close, volume]. */
const CANDLE_CLOSE = 4;

/**
 * @typedef {Awaited<ReturnType<typeof getOpenIntradayPositionsBefore>>[number]} OpenPosition
 * @typedef {{ ok: boolean, code?: string, message?: string }} CloseResult
 * @typedef {{ at: number, when: string, found: number, closed: number }} SquareOffRun
 */

/** The quote API key of a position's instrument, e.g. NFO:NIFTY26NOV24000CE. */
const quoteKey = (/** @type {OpenPosition} */ position) => `${position.exchange}:${position.tradingsymbol}`;

/** The IST trading day an intraday position belongs to: the day it was opened. */
const sessionDateOf = (/** @type {OpenPosition} */ position) => marketDate(new Date(position.entryTime));

/** A position's closing price's key: its instrument on its session's day. */
const priceKey = (/** @type {OpenPosition} */ position) => `${quoteKey(position)}|${sessionDateOf(position)}`;

/**
 * A session square-off service. Everything it talks to is injectable, for tests.
 * @param {{
 *   db?: { getOpenIntradayPositionsBefore: typeof getOpenIntradayPositionsBefore },
 *   quotes?: typeof fetchQuotes,
 *   dayCandles?: typeof fetchDayCandles,
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   clock?: () => Date,
 * }} [deps]
 */
export function createSessionSquareOff({
  db = { getOpenIntradayPositionsBefore },
  quotes = fetchQuotes,
  dayCandles = fetchDayCandles,
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

  /**
   * The close of the position's daily candle on its session's day; undefined (logged) when Kite has none or refuses.
   * @param {{ apiKey: string, accessToken: string }} kite
   * @param {OpenPosition} position
   */
  async function candleClose(kite, position) {
    const date = sessionDateOf(position);
    try {
      const candles = await dayCandles(kite, position.instrumentToken, date, date);
      return /** @type {number | undefined} */ (candles?.[0]?.[CANDLE_CLOSE]);
    } catch (err) {
      log('could not fetch the closing price', { symbol: position.tradingsymbol, date, reason: /** @type {Error} */ (err).message });
      return undefined;
    }
  }

  /**
   * Each position's price at its session's close, by priceKey. Right after the close, the session that just ended
   * is priced at its last price (the quote API); an earlier session's at the close of that day's candle.
   * @param {{ apiKey: string, accessToken: string }} kite
   * @param {OpenPosition[]} positions
   * @param {Date} now
   */
  async function closingPrices(kite, positions, now) {
    const justEnded = isMarketOpen(now) ? null : marketDate(lastSessionEnd(now));
    /** @type {Map<string, number | undefined>} */
    const prices = new Map();
    const quoted = positions.filter((position) => sessionDateOf(position) === justEnded);
    if (quoted.length > 0) {
      const replies = await quotes(kite, [...new Set(quoted.map(quoteKey))]);
      for (const position of quoted) prices.set(priceKey(position), replies[quoteKey(position)]?.last_price);
    }
    for (const position of positions) {
      if (!prices.has(priceKey(position))) prices.set(priceKey(position), await candleClose(kite, position));
    }
    return prices;
  }

  /** Square off every open intraday position from an ended session at its session's closing price, dated at its end. */
  async function squareOffLeftovers() {
    const now = clock();
    const positions = await db.getOpenIntradayPositionsBefore(lastSessionEnd(now).toISOString());
    if (positions.length === 0) return;
    const kite = await findKiteSession();
    if (!kite) {
      log('no admin Kite login to price them', { open: positions.length, next: 'trying again in market hours' });
      return;
    }
    const prices = await closingPrices(kite, positions, now);
    let closed = 0;
    for (const position of positions) {
      const price = prices.get(priceKey(position));
      if (!price) {
        if (!loggedNoPrice.has(position.id)) log('no closing price', { position: position.id, symbol: position.tradingsymbol });
        loggedNoPrice.add(position.id);
        continue;
      }
      const result = await orders.squareOff(position, { price, at: sessionEnd(sessionDateOf(position)), exitReason: SESSION_SQUARE_OFF });
      if (result.ok) closed += 1;
      else if (result.code !== NOT_FOUND) log('could not square off', { position: position.id, reason: result.message ?? result.code ?? '' });
    }
    const when = isMarketOpen(now) ? 'in market hours' : 'after the close';
    lastRun = { at: now.getTime(), when, found: positions.length, closed };
    log('squared off', { when, found: positions.length, closed, left: positions.length - closed });
  }

  return {
    id: SESSION_SQUARE_OFF_SERVICE_ID,

    /** Run on the market clock: square off after each close, and pick up leftovers while the market is open. */
    start(/** @type {import('../host.js').PluginContext} */ ctx) {
      orders = ctx.services.orders;
      log = ctx.log;
      ctx.market.onClose(squareOffLeftovers);
      ctx.market.every(LEFTOVER_CHECK_MS, squareOffLeftovers);
    },

    /** The last square-off, for Admin Services. */
    status: () => ({ lastRun }),
  };
}
