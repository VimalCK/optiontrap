import { describe, it, expect } from 'vitest';
import { istClock, isAfterCloseOnWeekday, daysBefore } from './marketClock.js';

// IST is UTC+05:30, so 10:15 UTC is 15:45 IST.
const utc = (iso) => new Date(`${iso}Z`);

describe('istClock', () => {
  it('converts to the IST date, weekday and minutes', () => {
    expect(istClock(utc('2026-10-23T10:15:00'))).toEqual({ date: '2026-10-23', weekday: 5, minutes: 15 * 60 + 45 });
  });

  it('rolls over to the next IST day before UTC does', () => {
    // 19:00 UTC Friday is 00:30 IST Saturday
    expect(istClock(utc('2026-10-23T19:00:00'))).toMatchObject({ date: '2026-10-24', weekday: 6, minutes: 30 });
  });
});

describe('isAfterCloseOnWeekday', () => {
  it('is due from 15:45 IST on weekdays', () => {
    expect(isAfterCloseOnWeekday(utc('2026-10-19T10:14:00'))).toBe(false); // Mon 15:44
    expect(isAfterCloseOnWeekday(utc('2026-10-19T10:15:00'))).toBe(true);  // Mon 15:45
    expect(isAfterCloseOnWeekday(utc('2026-10-23T18:29:00'))).toBe(true);  // Fri 23:59
  });

  it('is not due at weekends or before the close', () => {
    expect(isAfterCloseOnWeekday(utc('2026-10-24T11:00:00'))).toBe(false); // Sat 16:30
    expect(isAfterCloseOnWeekday(utc('2026-10-25T11:00:00'))).toBe(false); // Sun 16:30
    expect(isAfterCloseOnWeekday(utc('2026-10-20T04:00:00'))).toBe(false); // Tue 09:30
  });
});

describe('daysBefore', () => {
  it('handles month and year boundaries', () => {
    expect(daysBefore('2026-10-23', 14)).toBe('2026-10-09');
    expect(daysBefore('2026-11-03', 14)).toBe('2026-10-20');
    expect(daysBefore('2026-01-05', 14)).toBe('2025-12-22');
  });
});
