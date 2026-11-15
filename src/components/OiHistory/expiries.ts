import { formatCalendarDate } from '@/utils/marketStatus';

/** Short expiry label, day first: '2026-07-07' → '7 Jul', with ' (M)' for a monthly expiry */
export function expiryLabel(expiry: string, isMonthly: boolean): string {
  return `${formatCalendarDate(expiry, { day: 'numeric', month: 'short' })}${isMonthly ? ' (M)' : ''}`;
}

/**
 * Build the set of monthly expiries from a list of expiry dates.
 * A monthly expiry is the last (latest) expiry within its calendar month.
 * This is data-driven and robust to exchange weekday changes (Thu → Tue, etc.).
 */
export function computeMonthlyExpiries(allExpiries: string[]): Set<string> {
  const lastPerMonth = new Map<string, string>();
  for (const exp of allExpiries) {
    const key = exp.slice(0, 7);
    const cur = lastPerMonth.get(key);
    if (!cur || exp > cur) lastPerMonth.set(key, exp);
  }
  return new Set(lastPerMonth.values());
}
