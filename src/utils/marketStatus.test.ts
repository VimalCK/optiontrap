import { describe, it, expect } from 'vitest';
import { formatCalendarDate, formatNumericDate, istDateString, istDaysUntil, istTimeLabel } from './marketStatus';

describe('formatNumericDate', () => {
  it('shows the day first, then the month, then the year', () => {
    expect(formatNumericDate('2026-11-03')).toBe('03-11-2026');
    expect(formatNumericDate('2026-11-03T10:00:00Z')).toBe('03-11-2026');
  });

  it('leaves anything that is not a date alone', () => {
    expect(formatNumericDate('')).toBe('');
    expect(formatNumericDate('not-a-date')).toBe('not-a-date');
  });
});

// 07:35 in Ireland (GMT) on 3 Nov 2026 is 13:05 IST.
const irelandMorning = new Date('2026-11-03T07:35:00Z');
// 20:00 GMT on 3 Nov is already 4 Nov in India.
const irelandEvening = new Date('2026-11-03T20:00:00Z');

describe('IST helpers', () => {
  it('give the IST time and date, not the browser time zone', () => {
    expect(istTimeLabel(irelandMorning)).toBe('13:05');
    expect(istDateString(irelandMorning)).toBe('2026-11-03');
    expect(istDateString(irelandEvening)).toBe('2026-11-04');
  });

  it('count days to expiry from the IST date', () => {
    expect(istDaysUntil('2026-11-03', irelandMorning)).toBe(0);
    expect(istDaysUntil('2026-11-10', irelandMorning)).toBe(7);
    expect(istDaysUntil('2026-11-03', irelandEvening)).toBe(-1);
  });

  it('label a calendar date without shifting the day', () => {
    expect(formatCalendarDate('2026-11-03', { day: '2-digit', month: 'short' })).toBe('03 Nov');
    expect(formatCalendarDate('not-a-date', { day: '2-digit' })).toBe('not-a-date');
  });
});
