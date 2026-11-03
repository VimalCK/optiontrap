/**
 * Market-clock helpers for scheduled jobs. Pure functions of a Date so they
 * can be tested without waiting for the clock. The time zone and session
 * hours come from shared/marketTime.js; this file only adds job timings.
 */

import { MARKET_CLOSE_MINUTES, addDays, marketClock } from '../shared/marketTime.js';

export { isMarketOpen } from '../shared/marketTime.js';

/** Market-zone calendar date (YYYY-MM-DD), weekday (0 = Sunday) and minutes since midnight. */
export const istClock = marketClock;

/** Fifteen minutes after the close, so the day's candles are final. */
export const AFTER_CLOSE_MINUTES = MARKET_CLOSE_MINUTES + 15;

/**
 * Whether the after-close job is due: a weekday at or after the close + 15 min.
 * Exchange holidays need no calendar — Kite returns no candle for the day,
 * so the run stores nothing new.
 */
export function isAfterCloseOnWeekday(now = new Date()) {
  const { weekday, minutes } = istClock(now);
  return weekday >= 1 && weekday <= 5 && minutes >= AFTER_CLOSE_MINUTES;
}

/** 22:00 market time: when the nightly jobs run, every day of the week. */
export const NIGHTLY_JOBS_MINUTES = 22 * 60;

/** Whether tonight's nightly jobs are due: at or after 22:00 market time, until midnight. */
export function isNightlyJobTime(now = new Date()) {
  return istClock(now).minutes >= NIGHTLY_JOBS_MINUTES;
}

/** The date `days` before `date` (YYYY-MM-DD). */
export function daysBefore(date, days) {
  return addDays(date, -days);
}
