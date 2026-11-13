import { describe, it, expect } from 'vitest';
import { compactNumber, niceTicks, payoffAt, payoffPaths, payoffRange, strikeNear } from './payoffGeometry';

describe('niceTicks', () => {
  it('lands on round 1/2/5 steps inside the range', () => {
    expect(niceTicks(621, 665, 2)).toEqual([640, 660]);
    expect(niceTicks(23000, 25000, 4)).toEqual([23000, 23500, 24000, 24500, 25000]);
  });

  it('gives the one rounded value when the range is empty', () => {
    expect(niceTicks(24000.4, 24000.4, 5)).toEqual([24000]);
  });
});

describe('payoffAt', () => {
  const points = [{ price: 100, payoff: -50 }, { price: 200, payoff: 50 }, { price: 300, payoff: 50 }];

  it('interpolates between samples and holds flat beyond both ends', () => {
    expect(payoffAt(points, 150)).toBe(0);
    expect(payoffAt(points, 175)).toBe(25);
    expect(payoffAt(points, 50)).toBe(-50);
    expect(payoffAt(points, 400)).toBe(50);
  });

  it('is zero with no curve', () => {
    expect(payoffAt([], 150)).toBe(0);
  });
});

describe('compactNumber', () => {
  it('shortens lakhs and thousands', () => {
    expect(compactNumber(150000)).toBe('1.5L');
    expect(compactNumber(-2500)).toBe('-3k');
    expect(compactNumber(999)).toBe('999');
  });
});

describe('payoffRange', () => {
  it('is symmetric about zero with 10% headroom over the larger side', () => {
    expect(payoffRange(-1000, 400)).toEqual({ yMin: -1100, yMax: 1100 });
    expect(payoffRange(200, 800)).toEqual({ yMin: -880, yMax: 880 });
  });

  it('never collapses to an empty range', () => {
    expect(payoffRange(0, 0)).toEqual({ yMin: -1.1, yMax: 1.1 });
  });
});

describe('payoffPaths', () => {
  const identity = (v: number) => v;
  const flipped = (v: number) => -v;

  it('splits the line at the zero crossing, so both parts meet on the axis', () => {
    const { profit, loss } = payoffPaths([{ price: 0, payoff: -10 }, { price: 20, payoff: 10 }], identity, flipped);
    expect(loss.line).toBe('M 0.0 10.0 L 10.0 0.0 ');
    expect(profit.line).toBe('M 10.0 0.0 L 20.0 -10.0 ');
    expect(profit.area).toBe('M 10.0 0.0 L 10.0 0.0 L 20.0 -10.0 L 20.0 0.0 Z ');
  });

  it('draws nothing for a side the curve never reaches', () => {
    const { loss } = payoffPaths([{ price: 0, payoff: 5 }, { price: 10, payoff: 10 }], identity, flipped);
    expect(loss).toEqual({ line: '', area: '' });
  });
});

describe('strikeNear', () => {
  it('snaps to the closest strike within reach, or none', () => {
    const x = (price: number) => price / 10;
    expect(strikeNear(2403, [24000, 24100], x, 10)).toBe(24000);
    expect(strikeNear(2408, [24000, 24100], x, 10)).toBe(24100);
    expect(strikeNear(2450, [24000, 24100], x, 10)).toBeNull();
  });
});
