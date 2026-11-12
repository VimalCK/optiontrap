/**
 * The market's clock: time zone, session hours and trading-day helpers.
 *
 * This is the ONLY place the exchange time zone and session hours are
 * defined. Browser and server both import it, and the nightly SQL jobs run
 * with their session time zone set from MARKET_TIME_ZONE. To trade a market
 * in another zone, change the constants here (and the holiday list).
 *
 * Dates are 'YYYY-MM-DD' strings in the market's zone; times of day are
 * minutes since midnight in that zone.
 */

import { MARKET_HOLIDAYS_2026 } from './marketHolidays.js';
import { MarketStatus } from './tradeEnums.js';

/** IANA time zone of the exchange (NSE). */
export const MARKET_TIME_ZONE = 'Asia/Kolkata';

/** Pre-open starts 09:00; the session runs 09:15–15:30 (market time). */
const PRE_OPEN_MINUTES = 9 * 60;
const MARKET_OPEN_MINUTES = 9 * 60 + 15;
export const MARKET_CLOSE_MINUTES = 15 * 60 + 30;


const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** @param {Date} now @returns {Record<string, string>} */
function parts(now) {
  return Object.fromEntries(PARTS.formatToParts(now).map((p) => [p.type, p.value]));
}

/**
 * Market-zone calendar date, weekday (0 = Sunday) and minutes since midnight.
 * @param {Date} [now]
 * @returns {{ date: string, weekday: number, minutes: number }}
 */
export function marketClock(now = new Date()) {
  const p = parts(now);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Today's market-zone date, 'YYYY-MM-DD'. */
export function marketDate(now = new Date()) {
  return marketClock(now).date;
}

/** Market-zone month, 'YYYY-MM'. */
export function marketMonth(now = new Date()) {
  return marketDate(now).slice(0, 7);
}

/** 'HH:MM' in the market zone. */
export function marketTimeLabel(now = new Date()) {
  const { minutes } = marketClock(now);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The market zone's offset from UTC at `at`, in ms (positive east of UTC).
 * @param {Date} at
 */
function zoneOffsetMs(at) {
  const p = parts(at);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at `minutes` past midnight, market time, on `date`.
 * @param {string} date 'YYYY-MM-DD'
 * @param {number} [minutes]
 */
export function marketDateTime(date, minutes = 0) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  // Not a date (e.g. '' before a page has data): an Invalid Date, as new Date() gives, not a throw.
  if (Number.isNaN(wall)) return new Date(NaN);
  return new Date(wall - zoneOffsetMs(new Date(wall)));
}

/** When the session closes on `date`. @param {string} date */
export function marketCloseTime(date) {
  return marketDateTime(date, MARKET_CLOSE_MINUTES);
}

/**
 * When the latest session before `now` ended: the first instant after its
 * closing minute (15:31 IST, since the session runs to the end of 15:30), today's
 * once it has passed on a trading day, else the previous trading day's.
 * @param {Date} [now]
 */
export function lastSessionEnd(now = new Date()) {
  let date = marketDate(now);
  const end = (/** @type {string} */ day) => marketDateTime(day, MARKET_CLOSE_MINUTES + 1);
  if (isTradingDay(date) && end(date) <= now) return end(date);
  do date = addDays(date, -1); while (!isTradingDay(date));
  return end(date);
}

/** Epoch ms of market-zone midnight starting the day that contains `timestamp`. */
export function marketDayStartMs(timestamp = Date.now()) {
  return marketDateTime(marketDate(new Date(timestamp))).getTime();
}

/**
 * `date` shifted by `days` calendar days ('YYYY-MM-DD'; negative goes back).
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Whole calendar days from `from` to `to` (both 'YYYY-MM-DD').
 * @param {string} from
 * @param {string} to
 */
export function daysBetween(from, to) {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS);
}

/**
 * Days from today (market zone) to `date`; negative once it has passed.
 * @param {string} date
 * @param {Date} [now]
 */
export function daysUntil(date, now = new Date()) {
  return daysBetween(marketDate(now), date);
}

/** Whether `date` is a weekday that isn't an exchange holiday. @param {string} date */
export function isTradingDay(date) {
  const weekday = new Date(Date.parse(date.slice(0, 10))).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !MARKET_HOLIDAYS_2026.includes(date.slice(0, 10));
}

/**
 * @param {Date} [now]
 * @returns {import('./tradeEnums.js').MarketStatusId}
 */
export function marketStatus(now = new Date()) {
  const { date, minutes } = marketClock(now);
  if (!isTradingDay(date)) return MarketStatus.Closed;
  if (minutes >= PRE_OPEN_MINUTES && minutes < MARKET_OPEN_MINUTES) return MarketStatus.PreOpen;
  if (minutes >= MARKET_OPEN_MINUTES && minutes <= MARKET_CLOSE_MINUTES) return MarketStatus.Live;
  if (minutes > MARKET_CLOSE_MINUTES && minutes <= MARKET_CLOSE_MINUTES + 30) return MarketStatus.PostClose;
  return MarketStatus.Closed;
}

/** Whether the session is open now (trading day, open–close inclusive). */
export function isMarketOpen(now = new Date()) {
  return marketStatus(now) === MarketStatus.Live;
}
