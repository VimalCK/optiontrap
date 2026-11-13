/** Pure functions of a Date, so the job timings can be tested without waiting for the clock. */

import { MARKET_CLOSE_MINUTES, addDays, marketClock, marketDateTime } from '../shared/marketTime.js';

export { isMarketOpen } from '../shared/marketTime.js';

export const istClock = marketClock;

/** Fifteen minutes after the close, so the day's candles are final. */
export const AFTER_CLOSE_MINUTES = MARKET_CLOSE_MINUTES + 15;

/** Exchange holidays need no calendar: Kite returns no candle for the day, so the run stores nothing new. */
export function isAfterCloseOnWeekday(now = new Date()) {
  const { weekday, minutes } = istClock(now);
  return weekday >= 1 && weekday <= 5 && minutes >= AFTER_CLOSE_MINUTES;
}

/** 08:30 market time: when the nightly jobs run, every day of the week. */
export const NIGHTLY_JOBS_MINUTES = 8 * 60 + 30;

/** A server that was down at 08:30 runs them as soon as it's back. */
export function isNightlyJobTime(now = new Date()) {
  return istClock(now).minutes >= NIGHTLY_JOBS_MINUTES;
}

/** By 08:30 Zerodha has published the day's instrument list. */
export const INSTRUMENTS_REFRESH_MINUTES = 8 * 60 + 30;

/** A table loaded earlier than this is out of date. */
export function currentInstrumentListStart(now = new Date()) {
  const { date, minutes } = istClock(now);
  const day = minutes >= INSTRUMENTS_REFRESH_MINUTES ? date : addDays(date, -1);
  return marketDateTime(day, INSTRUMENTS_REFRESH_MINUTES).getTime();
}

export function daysBefore(date, days) {
  return addDays(date, -days);
}
