import { describe, expect, it } from 'vitest';
import { cprLevels } from './pivotLevels.js';

describe('cprLevels', () => {
  it('works out the pivot, the CPR and R1–R2 / S1–S2 from the previous session', () => {
    // H 120, L 90, C 111: pivot 107, (H+L)/2 105 and its mirror 109.
    expect(cprLevels({ high: 120, low: 90, close: 111 })).toEqual({
      pivot: 107, bc: 105, tc: 109, r1: 124, s1: 94, r2: 137, s2: 77,
    });
  });

  it('keeps BC below TC when the close is in the lower half of the range', () => {
    // H 120, L 90, C 93: pivot 101, (H+L)/2 105 is the top and its mirror 97 the bottom.
    const levels = cprLevels({ high: 120, low: 90, close: 93 });
    expect(levels.bc).toBe(97);
    expect(levels.tc).toBe(105);
  });
});
