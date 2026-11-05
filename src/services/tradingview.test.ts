import { describe, it, expect } from 'vitest';
import { tradingViewUrl } from './tradingview';
import type { Underlying } from './underlyings';

// Price rows as /api/underlyings returns them (the values come from the instruments table).
const row = (name: string, tradingsymbol: string, tradingviewSymbol: string): Underlying => ({
  name, label: name, instrumentToken: 1, exchange: 'NSE', tradingsymbol, tradingviewSymbol, alwaysSnapshot: false, isMarketReference: false, isIndex: false,
});
const UNDERLYINGS = [row('IDX', 'IDX 50', 'TVIDX'), row('ACME', 'ACME', 'ACME')];
const chartOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('symbol')!);

describe('tradingViewUrl', () => {
  it("charts an option or future's underlying by its TradingView symbol", () => {
    expect(chartOf(tradingViewUrl('IDX25N1124000CE', 'NFO', UNDERLYINGS))).toBe('NSE:TVIDX');
    expect(chartOf(tradingViewUrl('ACME25NOVFUT', 'NFO', UNDERLYINGS))).toBe('NSE:ACME');
  });

  it('charts an underlying given by its F&O name or its price row', () => {
    expect(chartOf(tradingViewUrl('IDX', undefined, UNDERLYINGS))).toBe('NSE:TVIDX');
    expect(chartOf(tradingViewUrl('IDX 50', 'NSE', UNDERLYINGS))).toBe('NSE:TVIDX');
  });

  it('falls back to the plain symbol when the underlyings have not loaded or do not list it', () => {
    expect(chartOf(tradingViewUrl('IDX25N1124000CE', 'NFO'))).toBe('NSE:IDX');
    expect(chartOf(tradingViewUrl('OTHER', 'BSE', UNDERLYINGS))).toBe('BSE:OTHER');
  });
});
