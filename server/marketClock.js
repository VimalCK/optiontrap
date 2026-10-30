/**
 * IST market-clock helpers for scheduled jobs. Pure functions of a Date so
 * they can be tested without waiting for the clock.
 */

const IST_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** IST calendar date (YYYY-MM-DD), weekday (0 = Sunday) and minutes since midnight. */
export function istClock(now = new Date()) {
  const parts = Object.fromEntries(IST_PARTS.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** 15:45 IST: fifteen minutes after the 15:30 close, so the day's candles are final. */
export const AFTER_CLOSE_MINUTES = 15 * 60 + 45;

/**
 * Whether the after-close job is due: a weekday at or after 15:45 IST.
 * Exchange holidays need no calendar — Kite returns no candle for the day,
 * so the run stores nothing new.
 */
export function isAfterCloseOnWeekday(now = new Date()) {
  const { weekday, minutes } = istClock(now);
  return weekday >= 1 && weekday <= 5 && minutes >= AFTER_CLOSE_MINUTES;
}

/** 22:00 IST: when the nightly jobs run, every day of the week. */
export const NIGHTLY_JOBS_MINUTES = 22 * 60;

/** Whether tonight's nightly jobs are due: at or after 22:00 IST, until midnight. */
export function isNightlyJobTime(now = new Date()) {
  return istClock(now).minutes >= NIGHTLY_JOBS_MINUTES;
}

/** The IST date `days` before `date` (YYYY-MM-DD). */
export function daysBefore(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d - days));
  return shifted.toISOString().slice(0, 10);
}
