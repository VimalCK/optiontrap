/**
 * @typedef {{ high: number, low: number, close: number }} SessionRange
 * @typedef {{ pivot: number, bc: number, tc: number, r1: number, r2: number, s1: number, s2: number }} CprLevels
 */

/**
 * The Central Pivot Range and the first two floor-pivot supports and resistances from the previous session's high,
 * low and close: pivot (H+L+C)/3, the range's bottom (BC) and top (TC) from (H+L)/2 and its mirror 2·pivot − (H+L)/2,
 * ordered so BC is the lower; R1 2P−L, S1 2P−H, R2 P+(H−L), S2 P−(H−L).
 * @param {SessionRange} previous
 * @returns {CprLevels}
 */
export function cprLevels({ high, low, close }) {
  const pivot = (high + low + close) / 3;
  const middle = (high + low) / 2;
  const mirror = 2 * pivot - middle;
  return {
    pivot,
    bc: Math.min(middle, mirror),
    tc: Math.max(middle, mirror),
    r1: 2 * pivot - low,
    s1: 2 * pivot - high,
    r2: pivot + (high - low),
    s2: pivot - (high - low),
  };
}
