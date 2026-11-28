import { describe, expect, it } from 'vitest';
import { parseReplaySessionInput, parseReplayTradeInput, replayDateProblem, replayFillPrice, replayTradeResult } from './replay.js';
import { roundTripCharges } from './tradeCharges.js';
import { ReplayExitReason, ReplayReason } from './appEnums.js';
import { InstrumentType, OptionType, Side } from './tradeEnums.js';
import { marketDateTime } from './marketTime.js';

const NOW = new Date('2026-11-27T06:30:00Z'); // Fri 12:00 IST

describe('replayFillPrice', () => {
  it('buys above and sells below the price by 0.25%, on the tick', () => {
    expect(replayFillPrice(200, Side.BUY)).toBe(200.5);
    expect(replayFillPrice(200, Side.SELL)).toBe(199.5);
  });

  it('slips at least one tick on cheap options', () => {
    expect(replayFillPrice(4, Side.BUY)).toBe(4.05);
    expect(replayFillPrice(4, Side.SELL)).toBe(3.95);
  });

  it('never sells below one tick', () => {
    expect(replayFillPrice(0.05, Side.SELL)).toBe(0.05);
  });
});

describe('replayTradeResult', () => {
  it('nets the points over the quantity less Zerodha option charges', () => {
    const trade = { date: '2026-11-26', entryTime: '09:46', exitTime: '09:52', entryPrice: 175.5, exitPrice: 222.25, quantity: 65 };
    const charges = roundTripCharges(
      { instrumentType: InstrumentType.CE, side: Side.BUY, quantity: 65, entryPrice: 175.5, entryTime: marketDateTime('2026-11-26', 9 * 60 + 46) },
      222.25,
      marketDateTime('2026-11-26', 9 * 60 + 52),
    ).total;
    expect(replayTradeResult(trade)).toEqual({ points: 46.75, charges, net: Math.round((46.75 * 65 - charges) * 100) / 100 });
  });
});

describe('replayDateProblem', () => {
  it('accepts a past trading day and today', () => {
    expect(replayDateProblem('2026-11-26', NOW)).toBeNull();
    expect(replayDateProblem('2026-11-27', NOW)).toBeNull();
  });

  it('refuses a future day, a weekend and a malformed date', () => {
    expect(replayDateProblem('2026-11-30', NOW)).toBe('Pick a day that has already traded');
    expect(replayDateProblem('2026-11-22', NOW)).toBe('The market was closed on that day');
    expect(replayDateProblem('26-11-2026', NOW)).toBe('date must be YYYY-MM-DD');
  });
});

describe('parseReplaySessionInput', () => {
  it('reads a valid session', () => {
    expect(parseReplaySessionInput({ underlying: ' NIFTY ', date: '2026-11-26', expiry: '2026-12-01', lotSize: 65 }, NOW))
      .toEqual({ value: { underlying: 'NIFTY', date: '2026-11-26', expiry: '2026-12-01', lotSize: 65 } });
  });

  it('refuses a missing underlying or a bad lot size', () => {
    expect(parseReplaySessionInput({ date: '2026-11-26', expiry: '2026-12-01', lotSize: 65 }, NOW)).toEqual({ error: 'underlying is required' });
    expect(parseReplaySessionInput({ underlying: 'NIFTY', date: '2026-11-26', expiry: '2026-12-01', lotSize: 0 }, NOW))
      .toEqual({ error: 'lotSize must be a whole number above 0' });
  });
});

describe('parseReplayTradeInput', () => {
  const valid = {
    optionType: OptionType.CE, strike: 25800, tradingsymbol: 'NIFTY26D0125800CE', lots: 2,
    clickTime: '09:45', entryTime: '09:46', exitTime: '09:52', entryPrice: 175.5, exitPrice: 222.25,
    exitReason: ReplayExitReason.Manual, reasons: [ReplayReason.LevelHeld, ReplayReason.LevelHeld], note: '  held the low ', context: { index: 25750 },
  };

  it('reads a valid trade, dropping repeated reasons and trimming the note', () => {
    expect(parseReplayTradeInput(valid)).toEqual({ value: { ...valid, reasons: [ReplayReason.LevelHeld], note: 'held the low' } });
  });

  it('refuses times out of order', () => {
    expect(parseReplayTradeInput({ ...valid, exitTime: '09:40' })).toEqual({ error: 'The trade must be clicked, entered and exited in that order' });
  });

  it('refuses an unknown reason or exit reason', () => {
    expect(parseReplayTradeInput({ ...valid, reasons: ['Hunch'] })).toEqual({ error: 'reasons must be replay reasons' });
    expect(parseReplayTradeInput({ ...valid, exitReason: 'Stop' })).toEqual({ error: 'exitReason is not a replay exit reason' });
  });

  it('refuses a fractional lot count', () => {
    expect(parseReplayTradeInput({ ...valid, lots: 1.5 })).toEqual({ error: 'lots must be a whole number above 0' });
  });
});
