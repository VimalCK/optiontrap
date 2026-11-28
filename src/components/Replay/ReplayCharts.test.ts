import { describe, expect, it } from 'vitest';
import { axisMinutes } from './ReplayCharts';

// 09:15 to 15:20 is 366 minutes; offsets count from 09:15.
const SESSION = 366;

describe('axisMinutes', () => {
  it('labels every 30 minutes from the open, whatever the chart width', () => {
    for (const slot of [1.9, 3]) {
      const labels = axisMinutes(SESSION, slot);
      const gaps = labels.slice(1, -1).map((offset, i) => offset - labels[i]);
      expect(labels.slice(0, 3)).toEqual([0, 30, 60]); // 09:15, 09:45, 10:15
      expect(new Set(gaps)).toEqual(new Set([30]));
    }
  });

  it('never skips a step at the end: 14:45 is followed by 15:15, and 15:20 is left out when it would overlap it', () => {
    const labels = axisMinutes(SESSION, 1.9);
    expect(labels.slice(-2)).toEqual([330, 360]); // 14:45, 15:15
  });

  it('adds the last minute when there is room after the last step', () => {
    const labels = axisMinutes(SESSION, 14);
    expect(labels.slice(-2)).toEqual([360, 365]); // 15:15, 15:20
  });
});
