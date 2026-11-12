/**
 * Paper trade charges: what Zerodha would charge for the same orders, so
 * paper P&L after charges matches what a real trade would have kept.
 *
 * The rates are Zerodha's published NSE charges (zerodha.com/charges, checked
 * November 2026), kept as data: one schedule per segment. A rate change is a
 * one-line edit here. Every charge is on an order's turnover (price ×
 * quantity), except the flat ones:
 *   brokerage   flat ₹ per order, or a % of turnover capped at ₹ per order
 *   STT         % of turnover, on the side(s) the schedule names
 *   exchange    NSE transaction charge, % of turnover, both sides
 *   SEBI        ₹10 per crore of turnover, both sides
 *   stamp duty  % of turnover, buy side only
 *   GST         18% of brokerage + exchange + SEBI
 *   DP          flat ₹ per delivery sell (stocks held overnight)
 *
 * A paper position is charged when it closes, as two orders: its entry and
 * its exit (the opposite side) at the same quantity. Stocks are intraday when
 * entered and exited on the same IST day, else delivery. STT on options
 * exercised at expiry is not charged: paper positions are exited, never
 * exercised. Positions shows P&L before charges, as Kite does; the Journal,
 * Algo Trading and Win/Loss Patterns show it after.
 */
import { marketDate } from './marketTime.js';
import { ChargeSegment, InstrumentType, Side, isOptionType, oppositeSide } from './tradeEnums.js';

/** SEBI turnover fee: ₹10 per crore. */
const SEBI_RATE = 10 / 1e7;
/** GST on brokerage, exchange and SEBI charges. */
const GST_RATE = 0.18;

/**
 * @typedef {{ flat?: number, percent?: number, cap?: number }} BrokerageRule
 * @typedef {{ brokerage: BrokerageRule, stt: { BUY?: number, SELL?: number }, exchange: number,
 *             stamp: number, dpPerSell?: number }} ChargeSchedule
 * @typedef {import('./tradeEnums.js').ChargeSegmentId} ChargeSegmentId
 */

/** @type {Record<ChargeSegmentId, ChargeSchedule>} */
export const CHARGE_SCHEDULES = {
  [ChargeSegment.Option]: { brokerage: { flat: 20 }, stt: { SELL: 0.0015 }, exchange: 0.0003553, stamp: 0.00003 },
  [ChargeSegment.Future]: { brokerage: { percent: 0.0003, cap: 20 }, stt: { SELL: 0.0005 }, exchange: 0.0000183, stamp: 0.00002 },
  [ChargeSegment.EquityIntraday]: { brokerage: { percent: 0.0003, cap: 20 }, stt: { SELL: 0.00025 }, exchange: 0.0000307, stamp: 0.00003 },
  [ChargeSegment.EquityDelivery]: { brokerage: { flat: 0 }, stt: { BUY: 0.001, SELL: 0.001 }, exchange: 0.0000307, stamp: 0.00015, dpPerSell: 15.34 },
};

/**
 * Charges in ₹, each rounded to the paisa, and their total.
 * @typedef {{ brokerage: number, stt: number, exchange: number, sebi: number, stamp: number, gst: number,
 *             dp: number, total: number }} Charges
 */

const CHARGE_KEYS = /** @type {const} */ (['brokerage', 'stt', 'exchange', 'sebi', 'stamp', 'gst', 'dp']);

const paise = (/** @type {number} */ value) => Math.round(value * 100) / 100;

/** @param {Omit<Charges, 'total'>} parts @returns {Charges} */
function withTotal(parts) {
  const total = paise(CHARGE_KEYS.reduce((sum, key) => sum + parts[key], 0));
  return { ...parts, total };
}

/** @param {BrokerageRule} rule @param {number} turnover */
function brokerage(rule, turnover) {
  if (rule.flat !== undefined) return rule.flat;
  const byPercent = turnover * (rule.percent ?? 0);
  return rule.cap === undefined ? byPercent : Math.min(byPercent, rule.cap);
}

/**
 * One order's charges.
 * @param {ChargeSegmentId} segment
 * @param {import('./tradeEnums.js').SideId} side
 * @param {number} price
 * @param {number} quantity
 * @returns {Charges}
 */
export function orderCharges(segment, side, price, quantity) {
  const schedule = CHARGE_SCHEDULES[segment];
  const turnover = price * quantity;
  const parts = {
    brokerage: paise(brokerage(schedule.brokerage, turnover)),
    stt: paise(turnover * (schedule.stt[side] ?? 0)),
    exchange: paise(turnover * schedule.exchange),
    sebi: paise(turnover * SEBI_RATE),
    stamp: side === Side.BUY ? paise(turnover * schedule.stamp) : 0,
    dp: side === Side.SELL ? schedule.dpPerSell ?? 0 : 0,
    gst: 0,
  };
  parts.gst = paise((parts.brokerage + parts.exchange + parts.sebi) * GST_RATE);
  return withTotal(parts);
}

/** Two sets of charges added together. @param {Charges} a @param {Charges} b @returns {Charges} */
export function addCharges(a, b) {
  return withTotal(/** @type {Omit<Charges, 'total'>} */ (Object.fromEntries(CHARGE_KEYS.map((key) => [key, paise(a[key] + b[key])]))));
}

/**
 * The charge schedule for an instrument type; stocks are intraday when entered
 * and exited on the same IST day.
 * @param {string} instrumentType  CE, PE, FUT or EQ
 * @param {Date} entryTime
 * @param {Date} exitTime
 * @returns {ChargeSegmentId}
 */
export function chargeSegment(instrumentType, entryTime, exitTime) {
  if (isOptionType(instrumentType)) return ChargeSegment.Option;
  if (instrumentType === InstrumentType.FUT) return ChargeSegment.Future;
  return marketDate(entryTime) === marketDate(exitTime) ? ChargeSegment.EquityIntraday : ChargeSegment.EquityDelivery;
}

/**
 * A closed trade's charges: its entry order and its exit order (the opposite
 * side), both at its quantity.
 * @param {{ instrumentType: string, side: import('./tradeEnums.js').SideId, quantity: number, entryPrice: number, entryTime: Date }} trade
 * @param {number} exitPrice
 * @param {Date} exitTime
 * @returns {Charges}
 */
export function roundTripCharges(trade, exitPrice, exitTime) {
  const segment = chargeSegment(trade.instrumentType, trade.entryTime, exitTime);
  const exitSide = oppositeSide(trade.side);
  return addCharges(
    orderCharges(segment, trade.side, trade.entryPrice, trade.quantity),
    orderCharges(segment, exitSide, exitPrice, trade.quantity),
  );
}
