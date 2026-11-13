import { describe, it, expect } from 'vitest';
import type { OiHistoryRow } from './types';
import { OptionType } from '../../../shared/tradeEnums.js';
import { StrikeMode } from '../../../shared/appEnums.js';
import {
  STRIKE_RANGE, buildOiTable, expiryColors, groupDatesByMonth, latestVisibleDate, maxConsolidatedOi, nearestStrike,
  oiSeriesByToken, snapshotTime, strikeModeFor, strikesInRange,
} from './oiTable';

const row = (changes: Partial<OiHistoryRow>): OiHistoryRow => ({
  date: '2026-11-12', instrumentToken: 1, tradingsymbol: 'NIFTY26N1824000CE', strike: 24000, optionType: OptionType.CE,
  expiry: '2026-11-18', open: 0, high: 0, low: 0, close: 100, volume: 10, oi: 50000, spotClose: 24040, ...changes,
});

describe('strikeModeFor', () => {
  it('maps the Strikes choice to what the server fetches', () => {
    expect(strikeModeFor(STRIKE_RANGE.Specific)).toBe(StrikeMode.Specific);
    expect(strikeModeFor(STRIKE_RANGE.All)).toBe(StrikeMode.AllStored);
    expect(strikeModeFor(10)).toBe(StrikeMode.AtmRange);
  });
});

describe('groupDatesByMonth', () => {
  it('groups consecutive dates under their month', () => {
    expect(groupDatesByMonth(['2026-10-30', '2026-11-02', '2026-11-03'])).toEqual([
      { month: '2026-10', dates: ['2026-10-30'] },
      { month: '2026-11', dates: ['2026-11-02', '2026-11-03'] },
    ]);
  });
});

describe('latestVisibleDate', () => {
  it('opens on the latest date from the current month on, else the latest date', () => {
    const rows = [row({ date: '2026-10-30' }), row({ date: '2026-11-12' }), row({ date: '2026-11-11' })];
    expect(latestVisibleDate(rows, '2026-11')).toBe('2026-11-12');
    expect(latestVisibleDate([row({ date: '2026-10-30' })], '2026-11')).toBe('2026-10-30');
    expect(latestVisibleDate([], '2026-11')).toBeNull();
  });
});

describe('snapshotTime', () => {
  it("is the close for a past day, and now for today's live snapshot until the close", () => {
    const close = new Date('2026-11-12T10:00:00Z'); // 15:30 IST
    expect(snapshotTime('2026-11-11', new Date('2026-11-12T06:30:00Z')).toISOString()).toBe('2026-11-11T10:00:00.000Z');
    expect(snapshotTime('2026-11-12', new Date('2026-11-12T06:30:00Z')).toISOString()).toBe('2026-11-12T06:30:00.000Z'); // 12:00 IST
    expect(snapshotTime('2026-11-12', new Date('2026-11-12T12:00:00Z')).toISOString()).toBe(close.toISOString()); // 17:30 IST
  });
});

describe('oiSeriesByToken', () => {
  it("keeps each option's OI by date, oldest first, and skips the futures rows", () => {
    const series = oiSeriesByToken([
      row({ date: '2026-11-12', oi: 3 }),
      row({ date: '2026-11-10', oi: 1 }),
      row({ instrumentToken: 9, optionType: null, oi: 7 }),
    ]);
    expect(series.get(1)).toEqual([{ date: '2026-11-10', oi: 1 }, { date: '2026-11-12', oi: 3 }]);
    expect(series.has(9)).toBe(false);
  });
});

describe('nearestStrike', () => {
  it('picks the strike nearest the spot, the lower one on a tie', () => {
    const rows = [row({ strike: 24100 }), row({ strike: 24000 }), row({ strike: 23900 })];
    expect(nearestStrike(rows)).toBe(24000);
    expect(nearestStrike(rows.map((r) => ({ ...r, spotClose: 24050 })))).toBe(24000);
    expect(nearestStrike([])).toBeNull();
  });
});

describe('buildOiTable', () => {
  const weekly = '2026-11-18';
  const monthly = '2026-11-25';
  const isMonthly = (expiry: string) => expiry === monthly;
  const day = [
    row({ instrumentToken: 1, strike: 24000, optionType: OptionType.CE, expiry: weekly, oi: 100000, close: 120 }),
    row({ instrumentToken: 2, strike: 24000, optionType: OptionType.PE, expiry: weekly, oi: 80000, close: 90 }),
    row({ instrumentToken: 3, strike: 24000, optionType: OptionType.CE, expiry: monthly, oi: 50000, close: 200 }),
    row({ instrumentToken: 4, strike: 25000, optionType: OptionType.CE, expiry: weekly, oi: 2000, close: 5 }),
  ];
  const prev = [row({ instrumentToken: 1, oi: 90000, close: 110 })];

  it('fills each strike × expiry cell with today and the previous day', () => {
    const [atm] = buildOiTable(day, prev, [weekly, monthly], isMonthly);
    const cell = atm.cells.get(weekly)!;
    expect(cell).toMatchObject({ ceOi: 100000, cePrevOi: 90000, ceClose: 120, cePrevClose: 110, ceToken: 1, peOi: 80000, pePrevOi: undefined, peToken: 2 });
  });

  it('sums OI over the weekly expiries only, while there is one', () => {
    const [atm] = buildOiTable(day, prev, [weekly, monthly], isMonthly);
    expect(atm.ceConsolidatedOi).toBe(100000);
    expect(atm.peConsolidatedOi).toBe(80000);
  });

  it('dims a strike whose OI never reaches 5% of the largest, and sorts by strike', () => {
    const rows = buildOiTable(day, prev, [weekly, monthly], isMonthly);
    expect(rows.map((r) => [r.strike, r.dimmed])).toEqual([[24000, false], [25000, true]]);
  });

  it('leaves out hidden expiries, and is empty without rows or expiries', () => {
    expect(buildOiTable(day, prev, [weekly], isMonthly)[0].cells.has(monthly)).toBe(false);
    expect(buildOiTable([], prev, [weekly], isMonthly)).toEqual([]);
    expect(buildOiTable(day, prev, [], isMonthly)).toEqual([]);
  });

  it('gives the largest consolidated OI on either side', () => {
    expect(maxConsolidatedOi(buildOiTable(day, prev, [weekly, monthly], isMonthly))).toBe(100000);
  });
});

describe('strikesInRange', () => {
  const rows = [23800, 23900, 24000, 24100, 24200].map((strike) => ({ strike }) as never);
  const strikes = (list: { strike: number }[]) => list.map((r) => r.strike);

  it('keeps the given number of strikes each side of the ATM', () => {
    expect(strikes(strikesInRange(rows, 1, null, 24000))).toEqual([23900, 24000, 24100]);
    expect(strikes(strikesInRange(rows, 5, null, 24000))).toHaveLength(5);
  });

  it('keeps only the specific strike, or none until one is typed', () => {
    expect(strikes(strikesInRange(rows, STRIKE_RANGE.Specific, 24100, 24000))).toEqual([24100]);
    expect(strikesInRange(rows, STRIKE_RANGE.Specific, null, 24000)).toEqual([]);
  });

  it('keeps every strike for All', () => {
    expect(strikesInRange(rows, STRIKE_RANGE.All, null, 24000)).toHaveLength(5);
  });
});

describe('expiryColors', () => {
  it('cycles through the palette', () => {
    const colors = expiryColors(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(colors.get('g')).toBe(colors.get('a'));
    expect(colors.get('b')).not.toBe(colors.get('a'));
  });
});
