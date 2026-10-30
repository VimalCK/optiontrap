import { describe, it, expect } from 'vitest';
import { selectJobFiles } from './nightlyJobs.js';
import { isNightlyJobTime } from './marketClock.js';

// IST is UTC+05:30, so 16:30 UTC is 22:00 IST.
const utc = (iso) => new Date(`${iso}Z`);

describe('isNightlyJobTime', () => {
  it('is due from 22:00 IST until midnight, every day', () => {
    expect(isNightlyJobTime(utc('2026-10-19T16:29:00'))).toBe(false); // Mon 21:59
    expect(isNightlyJobTime(utc('2026-10-19T16:30:00'))).toBe(true);  // Mon 22:00
    expect(isNightlyJobTime(utc('2026-10-24T18:29:00'))).toBe(true);  // Sat 23:59
  });

  it('is not due after midnight IST', () => {
    expect(isNightlyJobTime(utc('2026-10-19T18:30:00'))).toBe(false); // Tue 00:00
  });
});

describe('selectJobFiles', () => {
  it('keeps .sql and .js jobs in filename order', () => {
    expect(selectJobFiles(['020_b.js', '010_a.sql', '030_c.sql'])).toEqual(['010_a.sql', '020_b.js', '030_c.sql']);
  });

  it('skips paused, hidden, test and other files', () => {
    expect(selectJobFiles(['_010_paused.sql', '.hidden.js', '020_x.test.js', 'README.md', '030_ok.sql'])).toEqual(['030_ok.sql']);
  });
});
