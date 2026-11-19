import { describe, it, expect } from 'vitest';
import { daySpread, sessionOutcome, sessionWindow, winChanceShare } from './sessionOutcome.js';
import { OptionType, Side } from '../tradeEnums.js';

describe('sessionWindow', () => {
  it('counts the minutes left today and the trading days to expiry, today as a share', () => {
    // Thu 19 Nov 12:30 IST: 180 of 375 minutes left; Fri 20 and Mon 23 (expiry) are trading days.
    const window = sessionWindow(new Date('2026-11-19T07:00:00Z'), '2026-11-23');
    expect(window.minutesLeft).toBe(180);
    expect(window.tradingDaysToExpiry).toBeCloseTo(180 / 375 + 2, 6);
  });

  it('is the whole next session once today has closed', () => {
    // Thu 19 Nov 16:00 IST: the next session is Fri 20 from its open.
    const window = sessionWindow(new Date('2026-11-19T10:30:00Z'), '2026-11-23');
    expect(window.minutesLeft).toBe(375);
    expect(window.tradingDaysToExpiry).toBeCloseTo(2, 6);
  });

  it('starts at the open before it', () => {
    // Thu 19 Nov 08:30 IST.
    expect(sessionWindow(new Date('2026-11-19T03:00:00Z'), '2026-11-23').minutesLeft).toBe(375);
  });

  it('has no days to expiry once the expiry has passed', () => {
    expect(sessionWindow(new Date('2026-11-19T07:00:00Z'), '2026-11-18').tradingDaysToExpiry).toBe(0);
  });
});

describe('daySpread', () => {
  it('splits the straddle\'s spread to expiry over the trading days left', () => {
    // Straddle 200 → spread to expiry 250, over 4 days → 125 a day.
    expect(daySpread(200, { minutesLeft: 375, tradingDaysToExpiry: 4 })).toBeCloseTo(125, 6);
    expect(daySpread(0, { minutesLeft: 375, tradingDaysToExpiry: 4 })).toBe(0);
  });
});

describe('sessionOutcome', () => {
  const market = { spotPrice: 25000, expectedMove: 200, window: { minutesLeft: 375, tradingDaysToExpiry: 3 } };
  const option = { optionType: OptionType.PE, strike: 24900, premium: 60, lotSize: 65 };

  it('favours a seller and costs a buyer: time decay works for one and against the other', () => {
    const sold = sessionOutcome({ ...option, side: Side.SELL }, market);
    const bought = sessionOutcome({ ...option, side: Side.BUY }, market);
    expect(sold?.winChance).toBeGreaterThan(50);
    expect(bought?.winChance).toBeLessThan(50);
    expect(sold?.expectedPnl).toBeGreaterThan(0);
    expect(bought?.expectedPnl).toBeLessThan(0);
  });

  it('sits closer to a coin flip with less of the session left', () => {
    const fullDay = sessionOutcome({ ...option, side: Side.SELL }, market);
    const lastHour = sessionOutcome({ ...option, side: Side.SELL }, { ...market, window: { minutesLeft: 60, tradingDaysToExpiry: 2.16 } });
    expect(lastHour?.winChance).toBeLessThan(fullDay?.winChance ?? 0);
    expect(lastHour?.winChance).toBeGreaterThan(50);
  });

  it('takes the round trip\'s charges off the expected P&L', () => {
    const sold = sessionOutcome({ ...option, side: Side.SELL }, market);
    expect(sold?.charges).toBeGreaterThan(0);
    // Brokerage alone is ₹40 a round trip: over 65 units that is ₹0.62 each.
    expect(sold?.charges).toBeGreaterThan(40 / 65);
  });

  it('leaves charges out when the lot size is not known', () => {
    expect(sessionOutcome({ ...option, lotSize: null, side: Side.SELL }, market)?.charges).toBe(0);
  });

  it('is null without an expected move, a premium or time left', () => {
    expect(sessionOutcome({ ...option, side: Side.SELL }, { ...market, expectedMove: 0 })).toBeNull();
    expect(sessionOutcome({ ...option, premium: 0, side: Side.SELL }, market)).toBeNull();
    expect(sessionOutcome({ ...option, side: Side.SELL }, { ...market, window: { minutesLeft: 0, tradingDaysToExpiry: 2 } })).toBeNull();
  });
});

describe('winChanceShare', () => {
  it('is none at the start, all at the end, and in proportion between', () => {
    expect(winChanceShare(50, 50, 75)).toBe(0);
    expect(winChanceShare(62.5, 50, 75)).toBeCloseTo(0.5);
    expect(winChanceShare(90, 50, 75)).toBe(1);
    expect(winChanceShare(40, 50, 75)).toBe(0);
  });
});
