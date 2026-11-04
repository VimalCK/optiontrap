import { describe, it, expect } from 'vitest';
import { fitRange, isOverYear, rangeProblem, subtractMonths } from './journalRange';

const TODAY = '2026-11-05';

describe('rangeProblem', () => {
  it('accepts a complete range in order, of any length', () => {
    expect(rangeProblem('2026-08-05', '2026-11-05')).toBeNull();
    expect(rangeProblem('2026-11-05', '2026-11-05')).toBeNull();
    expect(rangeProblem('2020-01-01', '2026-11-05')).toBeNull(); // shortened on Report, not blocked
  });

  it('blocks a missing or half-typed date', () => {
    expect(rangeProblem('', '2026-11-05')).toBe('Pick both a From and a To date.');
    expect(rangeProblem('2026-08-05', '')).toBe('Pick both a From and a To date.');
  });

  it('blocks From after To', () => {
    expect(rangeProblem('2026-11-06', '2026-11-05')).toBe('From must not be after To.');
  });
});

describe('typing a From date year digit by digit', () => {
  // Chrome reports each keystroke of the year as a full date value.
  const keystrokes = ['0002-08-01', '0020-08-01', '0202-08-01', '2026-08-01'];

  it('never changes To, and Report works once the year is complete', () => {
    const to = TODAY;
    // Nothing reacts to the in-between values; only the final one matters.
    const from = keystrokes[keystrokes.length - 1];
    expect(rangeProblem(from, to)).toBeNull();
    expect(fitRange(from, to)).toEqual({ from: '2026-08-01', to: TODAY });
  });

  it('the in-between values are complete dates, which is why reacting to them broke To', () => {
    // The old code moved To to a year after '0002-08-01' at the first keystroke.
    expect(isOverYear(keystrokes[0], TODAY)).toBe(true);
  });
});

describe('fitRange', () => {
  it('leaves a range of a year or less alone', () => {
    expect(fitRange('2025-11-05', '2026-11-05')).toEqual({ from: '2025-11-05', to: '2026-11-05' });
    expect(fitRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('shortens a longer range to the year ending on To', () => {
    expect(fitRange('2024-01-01', '2026-11-05')).toEqual({ from: '2025-11-04', to: '2026-11-05' });
  });

  it('keeps To as picked, so the recent trades are the ones shown', () => {
    // From 1 Feb 2025 to today used to report Feb 2025 – Feb 2026 and miss every recent trade.
    const range = fitRange('2025-02-01', TODAY);
    expect(range.to).toBe(TODAY);
    expect(isOverYear(range.from, range.to)).toBe(false);
  });
});

describe('isOverYear', () => {
  it('is true only for a valid range longer than 366 days', () => {
    expect(isOverYear('2025-11-04', '2026-11-05')).toBe(false); // 366 days
    expect(isOverYear('2025-11-03', '2026-11-05')).toBe(true);
    expect(isOverYear('2026-11-06', '2026-11-05')).toBe(false); // invalid, not "over a year"
  });
});

describe('subtractMonths', () => {
  it('moves back calendar months, clamping to month end', () => {
    expect(subtractMonths('2026-11-05', 3)).toBe('2026-08-05');
    expect(subtractMonths('2026-11-05', 12)).toBe('2025-11-05');
    expect(subtractMonths('2026-05-31', 3)).toBe('2026-02-28');
  });
});
