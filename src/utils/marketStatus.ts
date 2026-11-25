/**
 * Browser-side market clock. The time zone, session hours and holidays live
 * in shared/marketTime.js (shared with the server); this file adapts it.
 */
import { daysUntil, marketClock, marketDate, marketStatus, marketTimeLabel } from '../../shared/marketTime.js';
import { MarketStatus, type MarketStatusId } from '../../shared/tradeEnums.js';

/** Pre-open, live, post-close (30 min after the close) or closed, by market time. */
export function getMarketStatus(): MarketStatusId {
  return marketStatus();
}

export function isMarketLive(): boolean {
  return getMarketStatus() === MarketStatus.Live;
}

/** Today's market-zone date (YYYY-MM-DD), whatever the browser's time zone. */
export function istDateString(now: Date = new Date()): string {
  return marketDate(now);
}

/** HH:MM in the market zone, whatever the browser's time zone. */
export function istTimeLabel(now: Date = new Date()): string {
  return marketTimeLabel(now);
}

const MINUTES_PER_HOUR = 60;
const HALF_DAY_HOURS = 12;

/** h:MM AM/PM in the market zone, whatever the browser's time zone. */
export function istTime12Label(now: Date = new Date()): string {
  const { minutes } = marketClock(now);
  const hour = Math.floor(minutes / MINUTES_PER_HOUR);
  const minute = String(minutes % MINUTES_PER_HOUR).padStart(2, '0');
  return `${hour % HALF_DAY_HOURS || HALF_DAY_HOURS}:${minute} ${hour < HALF_DAY_HOURS ? 'AM' : 'PM'}`;
}

/** Whole days from today (market zone) to a YYYY-MM-DD date; negative if it has passed. */
export function istDaysUntil(date: string, now: Date = new Date()): number {
  return daysUntil(date, now);
}

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Show a YYYY-MM-DD date day first: '2026-11-03' → '03-11-2026'. Dates are always shown
 * day, month, year across the app. Anything that isn't a date is returned unchanged.
 */
export function formatNumericDate(date: string): string {
  const match = ISO_DATE_PREFIX.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : date;
}

/** Label a YYYY-MM-DD date without shifting it by the browser's time zone. */
export function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions, locale = 'en-IN'): string {
  const ms = Date.parse(date.slice(0, 10));
  return Number.isNaN(ms) ? date : new Date(ms).toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}
