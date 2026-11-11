/**
 * Date-range rules for the trade journal's From / To filter.
 *
 * The journal fetches exactly the dates picked; nothing here changes them.
 * Typing a year into a date box goes through values like 0002, 0020 and 0202
 * on the way to 2026; those are treated as not picked yet, so no fetch runs
 * on a half-typed year.
 */

export const isDateValue = (value: string | undefined): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** A full date whose year has been typed out (not 0002, 0020 or 0202). */
const isCompleteDate = (value: string) => isDateValue(value) && !value.startsWith('0');

/** Why this range can't be fetched, or null when it can. */
export function rangeProblem(from: string, to: string): string | null {
  if (!isCompleteDate(from) || !isCompleteDate(to)) return 'Pick both a From and a To date.';
  if (from > to) return 'From must not be after To.';
  return null;
}

/**
 * The report to fetch for what the page shows: the paper journal's range (the
 * default one on opening, or whatever was picked since) with its segment, or
 * null when there's nothing to fetch (live mode, or a range that can't be).
 */
export function reportToFetch<S>(mode: string, from: string, to: string, segment: S): { from: string; to: string; segment: S } | null {
  if (mode !== 'paper' || rangeProblem(from, to)) return null;
  return { from, to, segment };
}

/** The 1M / 3M / 6M / 1Y buttons: `months` back from today, up to today. */
export function presetRange(today: string, months: number): { from: string; to: string } {
  return { from: subtractMonths(today, months), to: today };
}

/** `date` ('YYYY-MM-DD') moved back `n` calendar months, clamped to month end. */
export function subtractMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 - n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
