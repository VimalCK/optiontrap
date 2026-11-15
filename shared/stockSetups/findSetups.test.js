import { describe, it, expect } from 'vitest';
import { findSetups } from './findSetups.js';
import { day, ind, zone } from './candles.fixture.js';

describe('findSetups', () => {
  const prev = { date: day(0), open: 105, high: 106, low: 104, close: 105, volume: 1000 };

  it('finds a pullback into support in an uptrend that closes strong', () => {
    const last = { date: day(1), open: 101, high: 104, low: 99, close: 103.5, volume: 1000 };
    const [setup] = findSetups([prev, last], ind({ sma200: 90 }), 'Uptrend', [zone(98, 100)], [zone(115, 117, { side: 'Resistance' })], []);
    expect(setup).toMatchObject({ type: 'Pullback', direction: 'BUY', entry: 103.5, stop: 97, target: 115 });
    expect(setup.rewardRisk).toBeCloseTo(11.5 / 6.5, 9);
  });

  it('finds breakouts and breakdowns only on heavy volume', () => {
    const r = { low: 108, high: 110, mid: 109 };
    const up = { date: day(1), open: 109, high: 113, low: 108.5, close: 112, volume: 2000 };
    const breakout = findSetups([{ ...prev, close: 109 }, up], ind(), 'Sideways', [], [], [r]);
    expect(breakout.map((s) => s.type)).toEqual(['Breakout']);
    expect(breakout[0].stop).toBeCloseTo(107.5, 9);
    expect(findSetups([{ ...prev, close: 109 }, { ...up, volume: 1200 }], ind(), 'Sideways', [], [], [r])).toEqual([]);

    const down = { date: day(1), open: 109, high: 109.5, low: 105, close: 106, volume: 2000 };
    const breakdown = findSetups([{ ...prev, close: 109 }, down], ind(), 'Falling', [], [], [r]);
    expect(breakdown.map((s) => [s.type, s.direction])).toEqual([['Breakdown', 'SELL']]);
  });

  it('finds a rejection at resistance with a target at the support below', () => {
    const last = { date: day(1), open: 110, high: 111, low: 107.5, close: 108, volume: 1000 };
    const [setup] = findSetups([prev, last], ind({ sma50: 115 }), 'Falling', [zone(108, 109), zone(98, 100)], [zone(110, 112, { side: 'Resistance' })], []);
    expect(setup).toMatchObject({ type: 'Rejection', direction: 'SELL', entry: 108, stop: 113, target: 100 });
  });

  it('skips setups whose reward is smaller than their risk', () => {
    const last = { date: day(1), open: 101, high: 104, low: 99, close: 103.5, volume: 1000 };
    expect(findSetups([prev, last], ind({ sma200: 90 }), 'Uptrend', [zone(98, 100)], [zone(105, 106, { side: 'Resistance' })], [])).toEqual([]);
  });
});
