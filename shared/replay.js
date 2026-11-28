/**
 * Replay (pages/Replay): a past session played back minute by minute, where the player buys an ATM option and exits
 * it. These are the rules the browser plays by and the server records trades by, so both price a trade the same way.
 *
 * Fills: a click fills at the next minute's open, as an order sent during a minute would. A 1-minute candle has no
 * bid or ask, so each fill pays a slippage of REPLAY_SLIPPAGE_PERCENT of the price (at least one tick): a buy above
 * the price, a sell below it. Charges are Zerodha's option charges (shared/tradeCharges.js).
 */
import { MARKET_CLOSE_MINUTES, isTradingDay, marketDate, marketDateTime } from './marketTime.js';
import { roundTripCharges } from './tradeCharges.js';
import { InstrumentType, Side, isOptionType } from './tradeEnums.js';
import { isReplayExitReason, isReplayReason } from './appEnums.js';

export const REPLAY_SLIPPAGE_PERCENT = 0.25;
const TICK = 0.05;
/** Open replay positions close at this minute's close, ten minutes before the session's. */
export const REPLAY_SQUARE_OFF_MINUTES = MARKET_CLOSE_MINUTES - 10;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const toTick = (/** @type {number} */ price) => Math.round(price / TICK) * TICK;
const paise = (/** @type {number} */ value) => Math.round(value * 100) / 100;

/** Minutes since midnight of an 'HH:MM' time. */
export const minutesOf = (/** @type {string} */ time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * The price a replay order fills at from a candle price: a buy pays the slippage above it, a sell gets it below.
 * @param {number} price
 * @param {import('./tradeEnums.js').SideId} side
 */
export function replayFillPrice(price, side) {
  const slippage = Math.max(TICK, toTick(price * REPLAY_SLIPPAGE_PERCENT / 100));
  return paise(Math.max(TICK, side === Side.BUY ? price + slippage : price - slippage));
}

/**
 * A bought option's result: points per unit, Zerodha's charges for the round trip, and the net ₹ after them.
 * @param {{ date: string, entryTime: string, exitTime: string, entryPrice: number, exitPrice: number, quantity: number }} trade
 */
export function replayTradeResult({ date, entryTime, exitTime, entryPrice, exitPrice, quantity }) {
  const charges = roundTripCharges(
    { instrumentType: InstrumentType.CE, side: Side.BUY, quantity, entryPrice, entryTime: marketDateTime(date, minutesOf(entryTime)) },
    exitPrice,
    marketDateTime(date, minutesOf(exitTime)),
  ).total;
  const points = paise(exitPrice - entryPrice);
  return { points, charges, net: paise(points * quantity - charges) };
}

/**
 * Why `date` can't be replayed, or null: it must be a trading day, and not after today (market zone).
 * @param {unknown} date
 * @param {Date} [now]
 */
export function replayDateProblem(date, now = new Date()) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return 'date must be YYYY-MM-DD';
  if (date > marketDate(now)) return 'Pick a day that has already traded';
  if (!isTradingDay(date)) return 'The market was closed on that day';
  return null;
}

/**
 * A new replay session from a request body: { underlying, date, expiry, lotSize } (from the replay day the browser loaded).
 * @param {any} body
 * @param {Date} [now]
 * @returns {{ value: { underlying: string, date: string, expiry: string, lotSize: number } } | { error: string }}
 */
export function parseReplaySessionInput(body, now = new Date()) {
  const { underlying, date, expiry, lotSize } = body ?? {};
  if (typeof underlying !== 'string' || !underlying.trim()) return { error: 'underlying is required' };
  const dateProblem = replayDateProblem(date, now);
  if (dateProblem) return { error: dateProblem };
  if (typeof expiry !== 'string' || !DATE_PATTERN.test(expiry)) return { error: 'expiry must be YYYY-MM-DD' };
  if (!Number.isInteger(lotSize) || lotSize < 1) return { error: 'lotSize must be a whole number above 0' };
  return { value: { underlying: underlying.trim(), date, expiry, lotSize } };
}

/**
 * @typedef {{ optionType: import('./tradeEnums.js').OptionTypeId, strike: number, tradingsymbol: string, lots: number,
 *   clickTime: string, entryTime: string, exitTime: string, entryPrice: number, exitPrice: number,
 *   exitReason: import('./appEnums.js').ReplayExitReasonId, reasons: import('./appEnums.js').ReplayReasonId[],
 *   note: string | null, context: Record<string, unknown> | null }} ReplayTradeInput
 */

const isPrice = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isTime = (/** @type {unknown} */ value) => typeof value === 'string' && TIME_PATTERN.test(value);
const isPlainObject = (/** @type {unknown} */ value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A finished replay trade from a request body. The fill prices are the browser's, already through replayFillPrice;
 * the result (points, charges, net) is worked out by the server from them.
 * @param {any} body
 * @returns {{ value: ReplayTradeInput } | { error: string }}
 */
export function parseReplayTradeInput(body) {
  const b = body ?? {};
  if (!isOptionType(b.optionType)) return { error: 'optionType must be CE or PE' };
  if (!isPrice(b.strike)) return { error: 'strike must be above 0' };
  if (typeof b.tradingsymbol !== 'string' || !b.tradingsymbol) return { error: 'tradingsymbol is required' };
  if (!Number.isInteger(b.lots) || b.lots < 1) return { error: 'lots must be a whole number above 0' };
  if (!isTime(b.clickTime) || !isTime(b.entryTime) || !isTime(b.exitTime)) return { error: 'clickTime, entryTime and exitTime must be HH:MM' };
  if (b.entryTime < b.clickTime || b.exitTime < b.entryTime) return { error: 'The trade must be clicked, entered and exited in that order' };
  if (!isPrice(b.entryPrice) || !isPrice(b.exitPrice)) return { error: 'entryPrice and exitPrice must be above 0' };
  if (!isReplayExitReason(b.exitReason)) return { error: 'exitReason is not a replay exit reason' };
  const reasons = b.reasons ?? [];
  if (!Array.isArray(reasons) || !reasons.every(isReplayReason)) return { error: 'reasons must be replay reasons' };
  if (b.note != null && typeof b.note !== 'string') return { error: 'note must be text' };
  if (b.context != null && !isPlainObject(b.context)) return { error: 'context must be an object' };
  return {
    value: {
      optionType: b.optionType, strike: b.strike, tradingsymbol: b.tradingsymbol, lots: b.lots,
      clickTime: b.clickTime, entryTime: b.entryTime, exitTime: b.exitTime, entryPrice: b.entryPrice, exitPrice: b.exitPrice,
      exitReason: b.exitReason, reasons: [...new Set(reasons)], note: b.note?.trim() || null, context: b.context ?? null,
    },
  };
}
