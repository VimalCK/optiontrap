/**
 * Date-range rules for the trade journal's From / To filter.
 *
 * Report runs on exactly the dates picked; nothing here changes them. Typing
 * a year into a date box goes through values like 0002, 0020 and 0202 on the
 * way to 2026, so neither end may react to the other while it is edited.
 */

export const isDateValue = (value: string | undefined): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Why Report can't run on this range, or null when it can. */
export function rangeProblem(from: string, to: string): string | null {
  if (!isDateValue(from) || !isDateValue(to)) return 'Pick both a From and a To date.';
  if (from > to) return 'From must not be after To.';
  return null;
}

/** `date` ('YYYY-MM-DD') moved back `n` calendar months, clamped to month end. */
export function subtractMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 - n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
