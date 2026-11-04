import { describe, it, expect } from 'vitest';
import { rangeProblem, subtractMonths } from './journalRange';

const TODAY = '2026-11-05';

describe('rangeProblem', () => {
  it('accepts a complete range in order, of any length', () => {
    expect(rangeProblem('2026-08-05', '2026-11-05')).toBeNull();
    expect(rangeProblem('2026-11-05', '2026-11-05')).toBeNull();
    expect(rangeProblem('2025-02-01', TODAY)).toBeNull();
    expect(rangeProblem('2020-01-01', TODAY)).toBeNull();
  });

  it('blocks a missing or half-typed date', () => {
    expect(rangeProblem('', '2026-11-05')).toBe('Pick both a From and a To date.');
    expect(rangeProblem('2026-08-05', '')).toBe('Pick both a From and a To date.');
  });

  it('blocks From after To', () => {
    expect(rangeProblem('2026-11-06', '2026-11-05')).toBe('From must not be after To.');
  });
});

describe('subtractMonths', () => {
  it('moves back calendar months, clamping to month end', () => {
    expect(subtractMonths('2026-11-05', 3)).toBe('2026-08-05');
    expect(subtractMonths('2026-11-05', 12)).toBe('2025-11-05');
    expect(subtractMonths('2026-05-31', 3)).toBe('2026-02-28');
  });
});
