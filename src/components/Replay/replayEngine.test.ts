import { describe, expect, it } from 'vitest';
import { advance, atmStrike, canBuy, oiFlow, parseLots, placeEntry, placeExit, startState } from './replayEngine';

describe('parseLots', () => {
  it('reads a whole number of 1 or more as typed', () => {
    expect(parseLots('1')).toBe(1);
    expect(parseLots('12')).toBe(12);
  });

  it('refuses anything else instead of rewriting it', () => {
    for (const text of ['', ' ', '0', '-2', '2.5', 'abc']) expect(parseLots(text)).toBeNull();
  });
});
import { ReplayExitReason } from '../../../shared/appEnums.js';
import { OptionType } from '../../../shared/tradeEnums.js';
import type { OptionMinute, ReplayDay } from '@/services/replay';

const minute = (open: number, close: number, oi = 1000): OptionMinute => [open, close, 10, oi];

/** Index near 100 → ATM 100; the 100 call rises 10 → 15 over the minutes. */
function makeDay(times: string[], overrides: Partial<ReplayDay> = {}): ReplayDay {
  const n = times.length;
  const flat = (price: number) => Array.from({ length: n }, () => minute(price, price));
  return {
    underlying: 'NIFTY', label: 'NIFTY 50', date: '2026-11-26', expiry: '2026-12-01', lotSize: 50, prevClose: 99, prevDay: null,
    times,
    index: times.map(() => [100, 101, 99, 100]),
    strikes: [50, 100, 150],
    calls: { 50: flat(50), 100: Array.from({ length: n }, (_, i) => minute(10 + i, 10 + i + 0.5)), 150: flat(1) },
    puts: { 50: flat(1), 100: flat(10), 150: flat(50) },
    symbols: { 50: { CE: 'A50CE', PE: 'A50PE' }, 100: { CE: 'A100CE', PE: 'A100PE' }, 150: { CE: 'A150CE', PE: 'A150PE' } },
    ...overrides,
  };
}

const MORNING = ['09:15', '09:16', '09:17', '09:18', '09:19', '09:20', '09:21'];

describe('orders', () => {
  it('fills a buy at the next minute\'s open plus slippage, and an exit at the open after that less slippage', () => {
    const day = makeDay(MORNING);
    let state = advance(day, placeEntry(day, startState(), OptionType.CE, 2));
    expect(state.minute).toBe(1);
    expect(state.position).toMatchObject({ strike: 100, tradingsymbol: 'A100CE', clickTime: '09:15', entryTime: '09:16', entryPrice: 11.05, lots: 2 });
    state = advance(day, advance(day, state));
    state = advance(day, placeExit(state));
    expect(state.position).toBeNull();
    expect(state.closed).toEqual([expect.objectContaining({ entryTime: '09:16', exitTime: '09:19', exitPrice: 13.95, exitReason: ReplayExitReason.Manual })]);
  });

  it('allows one position at a time', () => {
    const day = makeDay(MORNING);
    const state = advance(day, placeEntry(day, startState(), OptionType.CE, 1));
    expect(canBuy(day, state, OptionType.PE)).toBe(false);
    expect(placeEntry(day, state, OptionType.PE, 1)).toBe(state);
  });

  it('squares off at 15:20 and ends the session', () => {
    const day = makeDay(['15:17', '15:18', '15:19', '15:20', '15:21']);
    let state = advance(day, placeEntry(day, startState(), OptionType.CE, 1));
    state = advance(day, state);
    expect(state.finished).toBe(false);
    state = advance(day, state);
    expect(state.finished).toBe(true);
    expect(state.closed).toEqual([expect.objectContaining({ exitTime: '15:20', exitPrice: 13.45, exitReason: ReplayExitReason.SquareOff })]);
  });

  it('squares off at the last minute when the day\'s data ends before 15:20 (a stock\'s candles to 15:14)', () => {
    const day = makeDay(['15:12', '15:13', '15:14']);
    let state = advance(day, placeEntry(day, startState(), OptionType.CE, 1));
    state = advance(day, state);
    expect(state.finished).toBe(false);
    state = advance(day, state);
    expect(state.finished).toBe(true);
    expect(state.position).toBeNull();
    expect(state.closed).toEqual([expect.objectContaining({ entryTime: '15:13', exitTime: '15:14', exitPrice: 12.45, exitReason: ReplayExitReason.SquareOff })]);
  });

  it('ends the session at 15:20 without a position too', () => {
    const day = makeDay(['15:19', '15:20', '15:21']);
    expect(advance(day, startState())).toMatchObject({ minute: 1, finished: true, closed: [] });
  });
});

describe('readings', () => {
  it('takes the strike nearest the index close as ATM', () => {
    const day = makeDay(MORNING, { index: MORNING.map(() => [130, 131, 129, 130]) });
    expect(atmStrike(day, 0)).toBe(150);
  });

  it('reads put writing as a positive OI flow, once there are five minutes', () => {
    const day = makeDay(MORNING);
    day.puts[100] = MORNING.map((_, i) => minute(10, 10, 1000 + i * 100));
    expect(oiFlow(day, 4)).toBeNull();
    // Puts at 100 added 500 in five minutes; the six contracts hold 5 × 1000 + 1500.
    expect(oiFlow(day, 5)).toBeCloseTo((500 / 6500) * 100);
  });
});
