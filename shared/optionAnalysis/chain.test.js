import { describe, it, expect } from 'vitest';
import { atmStrikeOf, averageVolume, buildOptionChain, strikeWindow, upcomingExpiries } from './chain.js';

const opt = (strike, instrumentType, expiry = '2026-11-10') => ({ instrumentToken: strike * 10 + (instrumentType === 'CE' ? 1 : 2), strike, instrumentType, expiry });
const rows = (strikes) => strikes.map((strike) => ({ strike, ce: null, pe: null }));

describe('upcomingExpiries', () => {
  it('lists expiries from today on, soonest first, without repeats', () => {
    const options = [opt(1, 'CE', '2026-11-17'), opt(1, 'CE', '2026-11-05'), opt(2, 'PE', '2026-11-17'), opt(1, 'CE', '2026-11-04')];
    expect(upcomingExpiries(options, '2026-11-05')).toEqual(['2026-11-05', '2026-11-17']);
  });
});

describe('buildOptionChain', () => {
  it('pairs the call and put of each strike of one expiry, by strike', () => {
    const chain = buildOptionChain([opt(200, 'PE'), opt(100, 'CE'), opt(200, 'CE'), opt(100, 'CE', '2026-11-17')], '2026-11-10');
    expect(chain).toEqual([
      { strike: 100, ce: opt(100, 'CE'), pe: null },
      { strike: 200, ce: opt(200, 'CE'), pe: opt(200, 'PE') },
    ]);
  });
});

describe('atmStrikeOf', () => {
  it('is the strike closest to spot, the first of two equally close', () => {
    expect(atmStrikeOf(rows([100, 150, 200]), 160)).toBe(150);
    expect(atmStrikeOf(rows([100, 150, 200]), 175)).toBe(150);
  });

  it('is the middle strike without a spot, and 0 for an empty chain', () => {
    expect(atmStrikeOf(rows([100, 150, 200, 250]), 0)).toBe(200);
    expect(atmStrikeOf([], 100)).toBe(0);
  });
});

describe('strikeWindow', () => {
  const chain = rows(Array.from({ length: 50 }, (_, i) => i));

  it('keeps 15 strikes either side of ATM', () => {
    const window = strikeWindow(chain, 25);
    expect(window.map((r) => r.strike)).toEqual(Array.from({ length: 31 }, (_, i) => 10 + i));
  });

  it('shifts rather than shrinks at either edge of the chain', () => {
    expect(strikeWindow(chain, 2).map((r) => r.strike)).toEqual(Array.from({ length: 31 }, (_, i) => i));
    expect(strikeWindow(chain, 48).map((r) => r.strike)).toEqual(Array.from({ length: 31 }, (_, i) => 19 + i));
  });

  it('keeps the whole chain when it is shorter than the window', () => {
    expect(strikeWindow(rows([1, 2, 3]), 2).length).toBe(3);
  });
});

describe('averageVolume', () => {
  it('averages the options that traded, ignoring those with no volume', () => {
    const chain = [{ strike: 1, ce: opt(1, 'CE'), pe: opt(1, 'PE') }, { strike: 2, ce: opt(2, 'CE'), pe: null }];
    expect(averageVolume(chain, new Map([[11, 100], [12, 300], [21, 0]]))).toBe(200);
    expect(averageVolume(chain, new Map())).toBe(0);
  });
});
