/**
 * Date-range rules for the trade journal's From / To filter.
 *
 * The range is only checked and adjusted when Report is pressed, never while
 * a date is being edited: typing a year into a date box goes through values
 * like 0002, 0020 and 0202 on the way to 2026, and reacting to those would
 * corrupt the other end of the range.
 */
import { addDays, daysBetween } from '../../../shared/marketTime.js';

/** Longest range the server's daily P&L accepts: a year, plus a leap day. */
export const MAX_RANGE_DAYS = 366;

export const isDateValue = (value: string | undefined): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Why Report can't run on this range, or null when it can. */
export function rangeProblem(from: string, to: string): string | null {
  if (!isDateValue(from) || !isDateValue(to)) return 'Pick both a From and a To date.';
  if (from > to) return 'From must not be after To.';
  return null;
}

/** Whether Report will shorten this range to a year. */
export function isOverYear(from: string, to: string): boolean {
  return rangeProblem(from, to) === null && daysBetween(from, to) > MAX_RANGE_DAYS;
}

/**
 * The range Report runs on: unchanged when it is a year or less, otherwise
 * From moves up to one year before To. To is kept because it is the end the
 * calendar is drawn to, and usually today: the recent trades are the ones
 * wanted.
 */
export function fitRange(from: string, to: string): { from: string; to: string } {
  if (!isOverYear(from, to)) return { from, to };
  return { from: addDays(to, -MAX_RANGE_DAYS), to };
}

/** `date` ('YYYY-MM-DD') moved back `n` calendar months, clamped to month end. */
export function subtractMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 - n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
