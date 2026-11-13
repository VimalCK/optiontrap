/**
 * Works on YYYY-MM-DD calendar dates in UTC arithmetic, so the browser's
 * time zone never shifts a day. Weeks start on Monday.
 */

export interface CalendarMonth { year: number; month: number }

const DAYS_PER_WEEK = 7;

const pad = (n: number) => String(n).padStart(2, '0');

export const isoDate = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

export function monthOf(date: string): CalendarMonth {
  const [year, month] = date.split('-').map(Number);
  return { year, month };
}

export function shiftMonth({ year, month }: CalendarMonth, offset: number): CalendarMonth {
  const index = year * 12 + (month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthWeeks({ year, month }: CalendarMonth): (string | null)[][] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingBlanks = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % DAYS_PER_WEEK;
  const cells: (string | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDate(year, month, i + 1)),
  ];
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += DAYS_PER_WEEK) weeks.push(cells.slice(i, i + DAYS_PER_WEEK));
  return weeks;
}

export const isOutsideRange = (date: string, min?: string, max?: string): boolean =>
  Boolean((min && date < min) || (max && date > max));
