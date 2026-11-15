import { describe, it, expect } from 'vitest';
import { classifyPattern, patternColor } from './rolloverPatterns';

describe('classifyPattern', () => {
  type Entry = { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined };
  const near = '2026-10-27';
  const far = '2026-11-24';
  const map = (entries: Record<string, Entry>) => new Map(Object.entries(entries));

  it('returns a dash when no expiry has data', () => {
    expect(classifyPattern(new Map(), [near, far])).toBe('None');
    expect(classifyPattern(new Map(), [near])).toBe('None');
  });

  it('uses the OI/price quadrant for a single expiry', () => {
    const data = map({ [near]: { oi: 1100, prevOi: 1000, close: 105, prevClose: 100 } });
    expect(classifyPattern(data, [near])).toBe('LongBuildup');
  });

  it('detects rolling over: near OI falling, far OI rising', () => {
    const data = map({
      [near]: { oi: 800, prevOi: 1000, close: 110, prevClose: 100 },
      [far]: { oi: 600, prevOi: 400, close: 105, prevClose: 100 },
    });
    expect(classifyPattern(data, [near, far])).toBe('RollingOverLong');
  });

  it('detects unwinding: both near and far OI falling', () => {
    const data = map({
      [near]: { oi: 800, prevOi: 1000, close: 100, prevClose: 100 },
      [far]: { oi: 300, prevOi: 400, close: 100, prevClose: 100 },
    });
    expect(classifyPattern(data, [near, far])).toBe('Unwinding');
  });

  it('detects doubling down and a fresh build', () => {
    expect(classifyPattern(map({
      [near]: { oi: 1200, prevOi: 1000, close: 90, prevClose: 100 },
      [far]: { oi: 500, prevOi: 400, close: 95, prevClose: 100 },
    }), [near, far])).toBe('DoublingDownShort');

    // Far expiry has no data → judged on the near expiry alone
    expect(classifyPattern(map({
      [near]: { oi: 1200, prevOi: 1000, close: 100, prevClose: 100 },
    }), [near, far])).toBe('FreshBuild');
  });

  it('treats a new far position as rising', () => {
    const data = map({
      [near]: { oi: 1000, prevOi: 1000, close: 100, prevClose: 100 },
      [far]: { oi: 500, prevOi: undefined, close: 100, prevClose: undefined },
    });
    expect(classifyPattern(data, [near, far])).toBe('FreshBuild');
  });
});

describe('patternColor', () => {
  it('colours patterns by meaning', () => {
    expect(patternColor('RollingOverLong')).toBe('var(--accent)');
    expect(patternColor('ExitingLongUnwind')).toBe('var(--loss)');
    expect(patternColor('LongBuildup')).toBe('var(--profit)');
    expect(patternColor('Stable')).toBe('var(--text-secondary)');
  });
});
