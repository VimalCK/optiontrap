/**
 * How an option trade entered now is likely to stand at today's close: the
 * chance it is in profit, and its expected P&L after Zerodha's charges for
 * one lot. Market data only. It replaces the probability of profit at expiry,
 * since the Strategy card's setups are traded within the session.
 *
 * Spot is modelled as normally distributed (Bachelier) with its spread taken
 * from the ATM straddle, as the rest of the setup scoring does. The option's
 * price follows spot by its delta and decays by its theta until the close:
 * decay pays a seller and costs a buyer. Spot's direction is not part of it;
 * the direction part of the score (dayBias.js) reads that.
 */
import { MARKET_CLOSE_MINUTES, MARKET_OPEN_MINUTES, addDays, isTradingDay, marketClock } from '../marketTime.js';
import { orderCharges } from '../tradeCharges.js';
import { ChargeSegment, OptionType, Side, oppositeSide } from '../tradeEnums.js';
import { STRADDLE_TO_SD, normalCdf } from './setupScoring.js';

export const SESSION_MINUTES = MARKET_CLOSE_MINUTES - MARKET_OPEN_MINUTES;

/**
 * The session a trade entered now is held in: minutes left until the close,
 * and trading days from now to expiry (today's part as a share of the
 * session). Outside the session it is the next session, from its open.
 * @typedef {{ minutesLeft: number, tradingDaysToExpiry: number }} SessionWindow
 * @param {Date} now
 * @param {string} expiry 'YYYY-MM-DD'
 * @returns {SessionWindow}
 */
export function sessionWindow(now, expiry) {
  const clock = marketClock(now);
  const today = isTradingDay(clock.date) && clock.minutes < MARKET_CLOSE_MINUTES;
  let entryDate = clock.date;
  if (!today) {
    do entryDate = addDays(entryDate, 1); while (!isTradingDay(entryDate));
  }
  const entryMinutes = today ? Math.max(clock.minutes, MARKET_OPEN_MINUTES) : MARKET_OPEN_MINUTES;
  const minutesLeft = MARKET_CLOSE_MINUTES - entryMinutes;
  const expiryDate = expiry.slice(0, 10);
  if (expiryDate < entryDate) return { minutesLeft, tradingDaysToExpiry: 0 };
  let days = minutesLeft / SESSION_MINUTES;
  for (let date = addDays(entryDate, 1); date <= expiryDate; date = addDays(date, 1)) {
    if (isTradingDay(date)) days += 1;
  }
  return { minutesLeft, tradingDaysToExpiry: days };
}

/**
 * Spot's spread (one standard deviation, in points) over one trading day; 0
 * without an expected move or days to expiry.
 * @param {number} expectedMove ATM straddle premium
 * @param {SessionWindow} window
 */
export function daySpread(expectedMove, window) {
  if (expectedMove <= 0 || window.tradingDaysToExpiry <= 0) return 0;
  return expectedMove / STRADDLE_TO_SD / Math.sqrt(window.tradingDaysToExpiry);
}

/**
 * @param {import('../tradeEnums.js').SideId} side
 * @param {number} premium
 * @param {number} quantity
 */
const roundTripChargesPerUnit = (side, premium, quantity) => (orderCharges(ChargeSegment.Option, side, premium, quantity).total
  + orderCharges(ChargeSegment.Option, oppositeSide(side), premium, quantity).total) / quantity;

/** @param {number} z */
const normalPdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

/**
 * @typedef {object} SessionOutcome
 * @property {number} winChance  1–99: the chance the trade is in profit at the close, after charges
 * @property {number} expectedPnl  ₹ per unit at the close, after charges
 * @property {number} charges  ₹ per unit, entry and exit, for one lot (0 when the lot size isn't known)
 */

/**
 * How an option trade entered now is likely to stand at today's close, or null
 * without an expected move, a premium or time left in the session.
 * @param {{ side: import('../tradeEnums.js').SideId, optionType: import('../tradeEnums.js').OptionTypeId, strike: number,
 *           premium: number, lotSize?: number | null }} trade
 * @param {{ spotPrice: number, expectedMove: number, window: SessionWindow }} market
 * @returns {SessionOutcome | null}
 */
export function sessionOutcome({ side, optionType, strike, premium, lotSize }, { spotPrice, expectedMove, window }) {
  const daysLeft = window.tradingDaysToExpiry;
  if (expectedMove <= 0 || premium <= 0 || window.minutesLeft <= 0 || daysLeft <= 0) return null;

  const spreadToExpiry = expectedMove / STRADDLE_TO_SD;
  const d = (spotPrice - strike) / spreadToExpiry;
  const delta = optionType === OptionType.CE ? normalCdf(d) : normalCdf(-d);
  const thetaPerDay = (normalPdf(d) * spreadToExpiry) / (2 * daysLeft);

  const heldDays = window.minutesLeft / SESSION_MINUTES;
  const decay = thetaPerDay * heldDays;
  const pnlSpread = delta * daySpread(expectedMove, window) * Math.sqrt(heldDays);

  const charges = lotSize ? roundTripChargesPerUnit(side, premium, lotSize) : 0;
  const expectedPnl = (side === Side.SELL ? decay : -decay) - charges;
  const winChance = pnlSpread > 0 ? 100 * normalCdf(expectedPnl / pnlSpread) : (expectedPnl > 0 ? 99 : 1);
  return { winChance: Math.min(99, Math.max(1, winChance)), expectedPnl, charges };
}

/**
 * The share of a part's points a win chance earns: none at `from`, all at `to`.
 * @param {number} winChance
 * @param {number} from
 * @param {number} to
 */
export const winChanceShare = (winChance, from, to) => Math.min(1, Math.max(0, (winChance - from) / (to - from)));
