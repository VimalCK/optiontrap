import { describe, it, expect } from 'vitest';
import { strikeGap } from './sellStrategy';
import type { OptionChainRow } from './optionChain';

const chainOf = (...strikes: number[]): OptionChainRow[] => strikes.map((strike) => ({ strike, ce: null, pe: null }));

describe('strikeGap', () => {
  it("is the chain's own distance between neighbouring strikes", () => {
    expect(strikeGap(chainOf(24400, 24450, 24500, 24550))).toBe(50);
    expect(strikeGap(chainOf(51900, 52000, 52100))).toBe(100);
    expect(strikeGap(chainOf(1380, 1400, 1420))).toBe(20);
  });

  it('uses the finest gap when far strikes are wider apart, whatever the order', () => {
    expect(strikeGap(chainOf(25000, 24500, 24550, 24600, 24800))).toBe(50);
  });

  it('is 0 with fewer than two strikes', () => {
    expect(strikeGap(chainOf(24500))).toBe(0);
    expect(strikeGap([])).toBe(0);
  });
});
