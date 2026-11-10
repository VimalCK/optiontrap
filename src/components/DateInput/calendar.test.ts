import { describe, it, expect } from 'vitest';
import { isOutsideRange, monthOf, monthWeeks, shiftMonth } from './calendar';

describe('monthWeeks', () => {
  it('lays November 2026 out Monday first: the 1st is a Sunday', () => {
    const weeks = monthWeeks({ year: 2026, month: 11 });
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks[weeks.length - 1]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it('counts 29 days in a leap February', () => {
    expect(monthWeeks({ year: 2028, month: 2 }).flat().filter(Boolean)).toHaveLength(29);
  });
});

describe('shiftMonth', () => {
  it('crosses year ends both ways', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('monthOf / isOutsideRange', () => {
  it('reads the month of a date', () => {
    expect(monthOf('2026-11-10')).toEqual({ year: 2026, month: 11 });
  });

  it('marks days before min or after max, and none when unset', () => {
    expect(isOutsideRange('2026-11-01', '2026-11-02')).toBe(true);
    expect(isOutsideRange('2026-11-06', undefined, '2026-11-05')).toBe(true);
    expect(isOutsideRange('2026-11-05', '2026-11-05', '2026-11-05')).toBe(false);
    expect(isOutsideRange('2026-11-05', '', '')).toBe(false);
  });
});
