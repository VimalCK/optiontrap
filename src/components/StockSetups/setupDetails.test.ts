import { describe, it, expect } from 'vitest';
import type { StockAnalysis, Zone } from '../../../shared/stockSetups.js';
import { LevelSide, MoveDirection } from '../../../shared/analysisEnums.js';
import { ladderLayout, perDayMove, priceBand, rsiLabel, sessionsTo, straddleDailyMove, zoneHistoryText } from './setupDetails';
import { backtestMessage } from './useSetupBacktest';

describe('sessionsTo', () => {
  const thursdayNoon = new Date('2026-11-12T06:30:00Z'); // Thu 12:00 IST

  it('counts the weekdays after today up to and including the expiry', () => {
    expect(sessionsTo('2026-11-13', thursdayNoon)).toBe(1);
    expect(sessionsTo('2026-11-17', thursdayNoon)).toBe(3); // Fri, Mon, Tue
  });

  it('counts by the IST date, not UTC: 23:30 UTC on Thursday is already Friday in India', () => {
    expect(sessionsTo('2026-11-17', new Date('2026-11-12T19:30:00Z'))).toBe(2); // Fri 01:00 IST
  });

  it('skips exchange holidays', () => {
    const fridayNoon = new Date('2026-11-20T06:30:00Z'); // Fri 12:00 IST
    expect(sessionsTo('2026-11-25', fridayNoon)).toBe(2); // Mon, Wed; Tue 24 Nov is Guru Nanak Jayanti
  });

  it('is zero on the expiry day and after it', () => {
    expect(sessionsTo('2026-11-12', thursdayNoon)).toBe(0);
    expect(sessionsTo('2026-11-10', thursdayNoon)).toBe(0);
  });
});

describe('straddleDailyMove', () => {
  it('scales the straddle to a standard move per session', () => {
    expect(straddleDailyMove(40, 4)).toBeCloseTo(40 / Math.sqrt(2 / Math.PI) / 2);
  });

  it('is null with no session left', () => {
    expect(straddleDailyMove(40, 0)).toBeNull();
  });
});

describe('rsiLabel', () => {
  it('names the bands at their edges', () => {
    expect(rsiLabel(29.9)).toEqual({ text: 'Oversold', tone: MoveDirection.Down });
    expect(rsiLabel(30)).toEqual({ text: 'Normal', tone: MoveDirection.Neutral });
    expect(rsiLabel(45)).toEqual({ text: 'Neutral', tone: MoveDirection.Neutral });
    expect(rsiLabel(55)).toEqual({ text: 'Neutral', tone: MoveDirection.Neutral });
    expect(rsiLabel(70)).toEqual({ text: 'Normal', tone: MoveDirection.Neutral });
    expect(rsiLabel(70.1)).toEqual({ text: 'Overbought', tone: MoveDirection.Up });
  });
});

const zone = (changes: Partial<Zone>): Zone => ({
  side: LevelSide.Support, low: 100, high: 105, strength: 2, distancePct: -3, reasons: [],
  history: { tests: 4, held: 3, failed: 1, avgMovePct: 2.46 },
  ...changes,
} as Zone);

describe('zoneHistoryText', () => {
  it('says how a support held and a resistance rejected, with breaks and the average move', () => {
    expect(zoneHistoryText(zone({}))).toBe('Held 3 of 4 · broke 1 · avg move 2.5%');
    expect(zoneHistoryText(zone({ side: LevelSide.Resistance, history: { tests: 2, held: 2, failed: 0, avgMovePct: null } }))).toBe('Rejected 2 of 2');
  });

  it('says so when the zone was never tested', () => {
    expect(zoneHistoryText(zone({ history: { tests: 0, held: 0, failed: 0, avgMovePct: null } }))).toBe('No past tests');
  });
});

describe('priceBand and perDayMove', () => {
  it('rounds to whole rupees from ₹100 up, and keeps paise below', () => {
    expect(priceBand(342, 19)).toBe('₹323 – ₹361');
    expect(priceBand(50, 1.25)).toBe('₹48.75 – ₹51.25');
  });

  it('shows a daily move with its share of the price', () => {
    expect(perDayMove(342, 5.8)).toBe('≈ ±₹5.8 a day (1.7%)');
    expect(perDayMove(2000, 24)).toBe('≈ ±₹24 a day (1.2%)');
  });
});

describe('ladderLayout', () => {
  it('places the price and zones between the outermost edges, with a 6% margin', () => {
    const analysis = { price: 110, supports: [zone({ low: 100, high: 105 })], resistances: [zone({ side: LevelSide.Resistance, low: 115, high: 120 })] } as StockAnalysis;
    const layout = ladderLayout(analysis)!;
    expect(layout.zones).toHaveLength(2);
    expect(layout.at(110)).toBe('50%');
    expect(parseFloat(layout.at(98.8))).toBeCloseTo(0);
  });

  it('draws nothing without zones', () => {
    expect(ladderLayout({ price: 110, supports: [], resistances: [] } as unknown as StockAnalysis)).toBeNull();
  });
});

describe('backtestMessage', () => {
  it('sums up the past year, or says there was nothing', () => {
    expect(backtestMessage({ found: 5, target: 2, stop: 1, expired: 1, open: 1 }))
      .toBe('Scorecard updated: 5 setup(s) in the past year — 2 target, 1 stop, 1 expired, 1 open.');
    expect(backtestMessage({ found: 0, target: 0, stop: 0, expired: 0, open: 0 })).toBe('No setups in the past year.');
  });
});
