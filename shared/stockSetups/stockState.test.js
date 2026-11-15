import { describe, it, expect } from 'vitest';
import { marketCheck, stockState } from './stockState.js';
import { analyzeStock } from './analysis.js';
import { day, fromCloses, ind } from './candles.fixture.js';

describe('state and market', () => {
  // A decline with up days in it; a perfectly straight one has RSI 0 and reads as stretched.
  const steadyFall = fromCloses(Array.from({ length: 80 }, (_, i) => 200 - i * 0.5 + 1.5 * Math.sin(i * 1.3)));

  it('reads a steady decline as falling and a crash as stretched', () => {
    const analysis = analyzeStock(steadyFall);
    expect(analysis.state).toBe('Falling');
    const crash = fromCloses([...Array.from({ length: 70 }, () => 200), ...Array.from({ length: 10 }, (_, i) => 196 - i * 6)]);
    expect(analyzeStock(crash).state).toBe('Stretched');
  });

  it('sees a turn when a falling stock closes above the previous high without a new low', () => {
    const turn = [...steadyFall.slice(0, -2)];
    const base = turn[turn.length - 1].close;
    turn.push({ date: day(78), open: base, high: base + 0.5, low: base - 0.2, close: base + 0.2, volume: 1000 });
    turn.push({ date: day(79), open: base + 0.2, high: base + 2.5, low: base + 0.1, close: base + 2.2, volume: 1000 });
    expect(stockState(turn, { ...ind(), sma20: 165, sma50: 175 }).state).toBe('Turning');
  });

  it('tells a stock falling on its own from one falling with the market', () => {
    const stock = fromCloses(Array.from({ length: 30 }, (_, i) => 100 - i));
    const flatMarket = fromCloses(Array.from({ length: 30 }, () => 20000));
    const fallingMarket = fromCloses(Array.from({ length: 30 }, (_, i) => 20000 * (1 - i * 0.009)));
    expect(marketCheck(stock, flatMarket).relation).toBe('Alone');
    expect(marketCheck(stock, fallingMarket).relation).toBe('WithMarket');
    // 20 sessions: from day 9 (91) to day 29 (71).
    expect(marketCheck(stock, flatMarket).stockPct).toBeCloseTo((71 / 91 - 1) * 100, 9);
  });
});
