import { describe, it, expect } from 'vitest';
import type { Position } from '@/services/positions';
import { Side } from '../../../shared/tradeEnums.js';
import { paperPositionPnl, paperPositionsPnl } from './paperPnl';

const position = (changes: Partial<Position>): Position => ({
  id: 'p1', instrumentToken: 1, side: Side.BUY, quantity: 75, entryPrice: 100, exited: false, ...changes,
} as Position);

describe('paperPositionPnl', () => {
  it('prices an open buy at the live price, and a sell the other way round', () => {
    expect(paperPositionPnl(position({}), 110)).toEqual({ value: 750, pct: 10 });
    expect(paperPositionPnl(position({ side: Side.SELL }), 110)).toEqual({ value: -750, pct: -10 });
  });

  it('prices an exited position at its exit price, ignoring the live one', () => {
    expect(paperPositionPnl(position({ exited: true, exitPrice: 90 }), 150)).toEqual({ value: -750, pct: -10 });
  });

  it('is zero while an open position has no price yet, and has no % without an entry price', () => {
    expect(paperPositionPnl(position({}), undefined)).toEqual({ value: 0, pct: 0 });
    expect(paperPositionPnl(position({ entryPrice: 0 }), 5).pct).toBe(0);
  });
});

describe('paperPositionsPnl', () => {
  it('adds up every position at its own price', () => {
    const positions = [position({}), position({ id: 'p2', instrumentToken: 2, side: Side.SELL, quantity: 50, entryPrice: 200 })];
    expect(paperPositionsPnl(positions, new Map([[1, 110], [2, 190]]))).toBe(750 + 500);
  });
});
