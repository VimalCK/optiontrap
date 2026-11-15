import { describe, it, expect } from 'vitest';
import { isCashStock, parseKiteCandles } from './candles.js';

describe('candles and instruments', () => {
  it('parses Kite rows, sorting oldest first and dropping malformed ones', () => {
    const candles = parseKiteCandles([
      ['2026-10-28T00:00:00+0530', 10, 12, 9, 11, 500],
      ['2026-10-27T00:00:00+0530', 9, 10, 8, 10, 400],
      ['bad'],
      ['2026-10-29T00:00:00+0530', 11, null, 10, 11, 300],
    ]);
    expect(candles).toEqual([
      { date: '2026-10-27', open: 9, high: 10, low: 8, close: 10, volume: 400 },
      { date: '2026-10-28', open: 10, high: 12, low: 9, close: 11, volume: 500 },
    ]);
  });

  it('covers NSE and BSE cash stocks only, not indices or F&O', () => {
    expect(isCashStock({ exchange: 'NSE', tradingsymbol: 'RELIANCE', instrumentType: 'EQ' })).toBe(true);
    expect(isCashStock({ exchange: 'NSE', tradingsymbol: 'BAJAJ-AUTO' })).toBe(true);
    expect(isCashStock({ exchange: 'BSE', tradingsymbol: 'SPICEJET', instrumentType: 'EQ' })).toBe(true);
    expect(isCashStock({ exchange: 'BFO', tradingsymbol: 'SENSEX26NOVFUT', instrumentType: 'FUT' })).toBe(false);
    expect(isCashStock({ exchange: 'NSE', tradingsymbol: 'NIFTY 50', instrumentType: 'EQ' })).toBe(false);
    expect(isCashStock({ exchange: 'NFO', tradingsymbol: 'RELIANCE26NOVFUT', instrumentType: 'FUT' })).toBe(false);
  });
});
