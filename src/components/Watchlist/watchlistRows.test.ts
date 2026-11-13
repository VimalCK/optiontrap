import { describe, it, expect } from 'vitest';
import type { Tick } from '@/services/kiteTicker';
import type { Instrument } from '@/services/instruments';
import type { WatchlistItem } from '@/services/watchlist';
import { changeClass, moveItem, priceChange, sameOrder, searchHits, withPriceTicks, type LivePrice } from './watchlistRows';

const tick = (instrumentToken: number, lastPrice: number, extra: Partial<Tick> = {}) => ({ instrumentToken, lastPrice, ...extra }) as Tick;

describe('withPriceTicks', () => {
  it('adds a new instrument with its close and day range', () => {
    const next = withPriceTicks(new Map(), [tick(1, 105, { closePrice: 100, highPrice: 106, lowPrice: 99 })]);
    expect(next.get(1)).toEqual({ ltp: 105, close: 100, high: 106, low: 99 });
  });

  it('keeps the known close and range when a tick leaves them out', () => {
    const prev = new Map<number, LivePrice>([[1, { ltp: 105, close: 100, high: 106, low: 99 }]]);
    expect(withPriceTicks(prev, [tick(1, 107)]).get(1)).toEqual({ ltp: 107, close: 100, high: 106, low: 99 });
  });

  it('returns the same map when no LTP moved', () => {
    const prev = new Map<number, LivePrice>([[1, { ltp: 105, close: 100, high: 106, low: 99 }]]);
    expect(withPriceTicks(prev, [tick(1, 105, { highPrice: 110 })])).toBe(prev);
  });
});

describe('priceChange and changeClass', () => {
  it('measures the move from the previous close', () => {
    expect(priceChange({ ltp: 110, close: 100, high: 0, low: 0 })).toEqual({ abs: 10, pct: 10 });
    expect(priceChange({ ltp: 110, close: 0, high: 0, low: 0 })).toEqual({ abs: 0, pct: 0 });
  });

  it('colours up and down moves only', () => {
    expect(changeClass({ abs: 1 })).toBe('wl-cell--up');
    expect(changeClass({ abs: -1 })).toBe('wl-cell--down');
    expect(changeClass({ abs: 0 })).toBe('');
    expect(changeClass(null)).toBe('');
  });
});

describe('searchHits', () => {
  it('leaves out instruments already in the list', () => {
    const instruments = [{ instrumentToken: 1 }, { instrumentToken: 2 }] as Instrument[];
    const items = [{ instrumentToken: 1 }] as WatchlistItem[];
    expect(searchHits(instruments, items, (list) => list).map((i) => i.instrumentToken)).toEqual([2]);
  });
});

describe('moveItem and sameOrder', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moves a row to where the target is, either way', () => {
    expect(moveItem(rows, 'a', 'c').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(moveItem(rows, 'c', 'a').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves the list alone for an unknown row', () => {
    expect(moveItem(rows, 'x', 'a')).toBe(rows);
  });

  it('compares orders by id', () => {
    expect(sameOrder(rows, [...rows])).toBe(true);
    expect(sameOrder(rows, moveItem(rows, 'a', 'b'))).toBe(false);
  });
});
