import { describe, it, expect } from 'vitest';
import {
  bsPrice,
  bsDelta,
  impliedVol,
  classifyFlow,
  computeFlowReadings,
  marketCloseIST,
  previousSessionClose,
  yearsToExpiry,
  type FlowInput,
} from './oiFlow';

describe('Black-Scholes', () => {
  it('matches textbook prices', () => {
    expect(bsPrice('CE', 100, 100, 1, 0.2, 0.05)).toBeCloseTo(10.4506, 3);
    expect(bsPrice('PE', 100, 100, 1, 0.2, 0.05)).toBeCloseTo(5.5735, 3);
  });

  it('gives call delta in (0,1) and put delta in (-1,0)', () => {
    expect(bsDelta('CE', 100, 100, 1, 0.2, 0.05)).toBeCloseTo(0.6368, 3);
    expect(bsDelta('PE', 100, 100, 1, 0.2, 0.05)).toBeCloseTo(-0.3632, 3);
  });
});

describe('impliedVol', () => {
  it('recovers the volatility used to price the option', () => {
    const years = 20 / 365;
    for (const vol of [0.08, 0.15, 0.4]) {
      const ce = bsPrice('CE', 24000, 24300, years, vol);
      const pe = bsPrice('PE', 24000, 23700, years, vol);
      expect(impliedVol('CE', ce, 24000, 24300, years)).toBeCloseTo(vol, 4);
      expect(impliedVol('PE', pe, 24000, 23700, years)).toBeCloseTo(vol, 4);
    }
  });

  it('returns null without time value or time', () => {
    expect(impliedVol('CE', 290, 24300, 24000, 10 / 365)).toBeNull();
    expect(impliedVol('CE', 50, 24000, 24000, 0)).toBeNull();
    expect(impliedVol('CE', 0, 24000, 24000, 10 / 365)).toBeNull();
  });
});

describe('dates', () => {
  it('measures time to 15:30 IST on expiry', () => {
    expect(yearsToExpiry(marketCloseIST('2026-10-26'), '2026-10-27') * 365).toBeCloseTo(1, 6);
  });

  it('steps back over weekends for the previous session', () => {
    // Monday 26 Oct 2026, 11:00 IST → Friday 23 Oct close
    expect(previousSessionClose(new Date('2026-10-26T05:30:00Z')).toISOString()).toBe(marketCloseIST('2026-10-23').toISOString());
    // Wednesday → Tuesday
    expect(previousSessionClose(new Date('2026-10-28T05:30:00Z')).toISOString()).toBe(marketCloseIST('2026-10-27').toISOString());
  });
});

describe('classifyFlow', () => {
  it('reads OI against IV relative to ATM', () => {
    expect(classifyFlow(true, 100, 0.01)).toBe('Buyers Adding');
    expect(classifyFlow(true, 100, -0.01)).toBe('Writers Adding');
    expect(classifyFlow(true, -100, -0.01)).toBe('Buyers Exiting');
    expect(classifyFlow(true, -100, 0.01)).toBe('Writers Covering');
    expect(classifyFlow(true, 100, 0.001)).toBe('Unclear');
    expect(classifyFlow(false, 100, 0.01)).toBe('Stable');
    expect(classifyFlow(true, 100, null)).toBe('-');
  });
});

describe('computeFlowReadings', () => {
  const asOf = marketCloseIST('2026-10-26');
  const prevAsOf = marketCloseIST('2026-10-23');
  const expiry = '2026-11-03';

  function input(token: number, optionType: 'CE' | 'PE', strike: number, vol: number, prevVol: number, oi: number, prevOi: number, extra: Partial<FlowInput> = {}): FlowInput {
    return {
      token,
      optionType,
      strike,
      expiry,
      oi,
      prevOi,
      price: bsPrice(optionType, 24000, strike, yearsToExpiry(asOf, expiry), vol),
      prevPrice: bsPrice(optionType, 24000, strike, yearsToExpiry(prevAsOf, expiry), prevVol),
      spot: 24000,
      prevSpot: 24000,
      asOf,
      prevAsOf,
      ...extra,
    };
  }

  it('ignores a chain-wide IV crush and finds the strike-specific move', () => {
    // Whole chain loses 3 pts of IV; 24300 CE loses only 1.5 pts while OI rises.
    const readings = computeFlowReadings([
      input(1, 'CE', 24000, 0.12, 0.15, 1000, 1000),
      input(2, 'PE', 24000, 0.12, 0.15, 1000, 1000),
      input(3, 'CE', 24300, 0.135, 0.15, 1500, 1000),
      input(4, 'CE', 24500, 0.11, 0.15, 1500, 1000),
    ]);
    expect(readings.get(1)!.atmIvChange).toBeCloseTo(-0.03, 3);
    expect(readings.get(3)!.relIvChange).toBeCloseTo(0.015, 3);
    expect(readings.get(3)!.label).toBe('Buyers Adding');
    expect(readings.get(4)!.label).toBe('Writers Adding');
    expect(readings.get(1)!.label).toBe('Stable');
  });

  it('weights OI change by delta so far OTM strikes count for less', () => {
    const readings = computeFlowReadings([
      input(1, 'CE', 24000, 0.15, 0.15, 150_000, 100_000),
      input(2, 'CE', 25000, 0.15, 0.15, 150_000, 100_000),
    ]);
    const atm = readings.get(1)!.deltaOiChange!;
    const otm = readings.get(2)!.deltaOiChange!;
    expect(atm).toBeGreaterThan(20_000);
    expect(otm).toBeLessThan(atm / 5);
  });

  it('judges OI moves against the strike history when there is enough', () => {
    const history = [1000, 1010, 1000, 1010, 1000];
    const readings = computeFlowReadings([
      input(1, 'CE', 24000, 0.15, 0.15, 1000, 1000),
      // +3% is above the flat 2% rule but only 3× a 10-contract typical day
      input(2, 'CE', 24300, 0.16, 0.15, 1030, 1000, { oiHistory: history, volume: 300 }),
      // +1.5% is below the flat rule, but no history means the flat rule applies
      input(3, 'CE', 24500, 0.16, 0.15, 1015, 1000),
    ]);
    const unusual = readings.get(2)!;
    expect(unusual.unusual).toBeCloseTo(3, 5);
    expect(unusual.label).toBe('Buyers Adding');
    expect(unusual.churn).toBeCloseTo(0.1, 5);
    expect(unusual.recentShare).toBeCloseTo((1030 - 1000) / 1030, 5);
    expect(readings.get(3)!.label).toBe('Stable');
  });
});
