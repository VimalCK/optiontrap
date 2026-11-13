import { describe, it, expect } from 'vitest';
import type { OptionChainRow, OptionInstrument } from '@/services/optionChain';
import type { QuoteData } from '@/services/kiteApi';
import type { Tick } from '@/services/kiteTicker';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import {
  chainTokens, expectedRangeBand, maxChainOi, oiAxisLabel, oiBar, optionPrice, percentChange, pricesFromQuotes,
  pricesFromSnapshot, quoteKeys, quoteStrikes, strikeLabelStep, tooltipBottomPx, withTicks,
} from './chainMetrics';

const option = (token: number, optionType: OptionTypeId = OptionType.CE): OptionInstrument => ({
  instrumentToken: token, exchangeToken: 0, tradingsymbol: `OPT${token}${optionType}`, name: 'NIFTY', expiry: '2026-11-18', strike: 0, instrumentType: optionType, lotSize: 75,
});
const row = (strike: number, ce: number | null, pe: number | null): OptionChainRow => ({
  strike, ce: ce === null ? null : option(ce), pe: pe === null ? null : option(pe, OptionType.PE),
});
const quote = (last: number, oi: number, close: number): QuoteData => ({ last_price: last, oi, volume: 0, ohlc: { open: 0, high: 0, low: 0, close } });

describe('percentChange', () => {
  it('gives the % move with its colour, or null without a base', () => {
    expect(percentChange(110, 100)).toEqual({ pct: 10, color: 'positive' });
    expect(percentChange(90, 100)).toEqual({ pct: -10, color: 'negative' });
    expect(percentChange(100, 100)).toEqual({ pct: 0, color: '' });
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(undefined, 100)).toBeNull();
  });
});

describe('optionPrice', () => {
  it('is the live price once positive', () => {
    expect(optionPrice(option(1), new Map([[1, 12.5]]))).toBe(12.5);
    expect(optionPrice(option(1), new Map([[1, 0]]))).toBeNull();
    expect(optionPrice(null, new Map())).toBeNull();
  });
});

describe('chain tokens and OI', () => {
  const chain = [row(24000, 1, 2), row(24100, 3, null)];

  it('lists CE before PE strike by strike', () => {
    expect(chainTokens(chain)).toEqual([1, 2, 3]);
  });

  it('finds the largest OI on either side', () => {
    expect(maxChainOi(chain, new Map([[1, 10], [2, 40], [3, 25]]))).toBe(40);
  });
});

describe('closed-market quotes', () => {
  const chain = Array.from({ length: 40 }, (_, i) => row(23000 + i * 100, i * 2 + 1, i * 2 + 2));

  it('quotes 15 strikes each side of the ATM, fewer near an edge', () => {
    expect(quoteStrikes(chain, 25000)).toHaveLength(31);
    expect(quoteStrikes(chain, 23000)).toHaveLength(16);
  });

  it('asks for the spot first, then each option on NFO', () => {
    expect(quoteKeys([row(24000, 1, 2)], 'NSE:NIFTY 50')).toEqual(['NSE:NIFTY 50', 'NFO:OPT1CE', 'NFO:OPT2PE']);
    expect(quoteKeys([row(24000, 1, null)], null)).toEqual(['NFO:OPT1CE']);
  });

  it('reads prices, OI and positive closes from the quotes, and names the missing ones', () => {
    const result = pricesFromQuotes([row(24000, 1, 2)], new Map([['NFO:OPT1CE', quote(120, 5000, 0)]]));
    expect(result.prices).toEqual(new Map([[1, 120]]));
    expect(result.oi).toEqual(new Map([[1, 5000]]));
    expect(result.close.size).toBe(0);
    expect(result.missing).toEqual(['NFO:OPT2PE']);
  });

  it("falls back to a snapshot's maps, by numeric token", () => {
    const fallback = pricesFromSnapshot({ timestamp: 0, timeLabel: '', data: { 1: 5000 }, prices: { 1: 120 } });
    expect(fallback.oi).toEqual(new Map([[1, 5000]]));
    expect(fallback.prices).toEqual(new Map([[1, 120]]));
    expect(fallback.close).toBeUndefined();
  });
});

describe('withTicks', () => {
  const ticks = [{ instrumentToken: 1, lastPrice: 10, oi: 500 }, { instrumentToken: 2, lastPrice: 20 }] as Tick[];

  it('sets the picked value per token and keeps the rest', () => {
    expect(withTicks(new Map([[3, 1]]), ticks, (t) => t.oi)).toEqual(new Map([[3, 1], [1, 500]]));
  });

  it('returns the same map when no tick has a value', () => {
    const prev = new Map([[3, 1]]);
    expect(withTicks(prev, ticks, (t) => t.volume)).toBe(prev);
  });
});

describe('expectedRangeBand', () => {
  const chain = [23800, 23900, 24000, 24100, 24200].map((strike) => row(strike, null, null));

  it('shades the strikes within the move of the spot', () => {
    expect(expectedRangeBand(chain, 24000, 100)).toEqual({ left: 20, right: 20 });
  });

  it('draws nothing without a move, a spot, or a strike inside', () => {
    expect(expectedRangeBand(chain, 24000, 0)).toBeNull();
    expect(expectedRangeBand(chain, 0, 100)).toBeNull();
    expect(expectedRangeBand(chain, 30000, 100)).toBeNull();
  });
});

describe('oiAxisLabel and strikeLabelStep', () => {
  it('labels OI in crore, lakh and thousand', () => {
    expect(oiAxisLabel(0)).toBe('0');
    expect(oiAxisLabel(12500000)).toBe('1.3Cr');
    expect(oiAxisLabel(250000)).toBe('2.5L');
    expect(oiAxisLabel(45000)).toBe('45K');
  });

  it('labels every other strike, or fewer when the columns are narrow', () => {
    expect(strikeLabelStep(0, 31)).toBe(2);
    expect(strikeLabelStep(1240, 31)).toBe(2); // 40 px a column
    expect(strikeLabelStep(310, 31)).toBe(4); // 10 px a column
  });
});

describe('oiBar', () => {
  it('highlights OI added since yesterday', () => {
    const bar = oiBar(100, 80, 0, 200, 0);
    expect(bar.height).toBe(50);
    expect(bar.addedPct).toBeCloseTo(20);
    expect(bar.shedMarker).toBeNull();
  });

  it("marks yesterday's level when OI fell", () => {
    expect(oiBar(60, 80, 0, 200, 0)).toMatchObject({ height: 30, addedPct: 0, shedMarker: 40 });
  });

  it('confirms an OI move over 3% on volume over 1.5× the average', () => {
    expect(oiBar(110, 100, 160, 200, 100).confirmed).toBe(true);
    expect(oiBar(110, 100, 150, 200, 100).confirmed).toBe(false);
    expect(oiBar(102, 100, 500, 200, 100).confirmed).toBe(false);
  });
});

describe('tooltipBottomPx', () => {
  it('clears the tallest bar', () => {
    const chain = [row(24000, 1, 2)];
    expect(tooltipBottomPx(chain, new Map([[1, 100], [2, 50]]), 100)).toBe(196);
    expect(tooltipBottomPx(chain, new Map(), 0)).toBe(16);
  });
});
