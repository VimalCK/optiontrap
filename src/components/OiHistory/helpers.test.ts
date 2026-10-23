import { describe, it, expect } from 'vitest';
import type { FuturesHistoryRow } from './types';
import {
  formatOiCompact,
  formatOiWithChg,
  addMonths,
  formatMonthLabel,
  formatMonthShortLabel,
  formatFullDateLabel,
  priceDirection,
  classifyOptionMove,
  patternBiasScore,
  pctChange,
  formatPct,
  formatPcr,
  buildFuturesSeries,
} from './helpers';

const futuresRow = (date: string, close: number, oi: number, volume = 1000): FuturesHistoryRow => ({
  date,
  instrumentToken: 1,
  tradingsymbol: 'NIFTY26OCTFUT',
  expiry: '2026-10-27',
  open: close,
  high: close,
  low: close,
  close,
  volume,
  oi,
});

describe('formatOiCompact', () => {
  it('uses M, K or the plain number', () => {
    expect(formatOiCompact(11_400_000)).toBe('11.4M');
    expect(formatOiCompact(850_000)).toBe('850K');
    expect(formatOiCompact(999)).toBe('999');
  });
});

describe('formatOiWithChg', () => {
  it('shows a dash for zero OI', () => {
    expect(formatOiWithChg(0, 100)).toEqual({ text: '-', chgCls: '' });
  });

  it('omits the change when there is no previous OI', () => {
    expect(formatOiWithChg(1_900_000, undefined)).toEqual({ text: '1.9M', chgCls: '' });
    expect(formatOiWithChg(1_900_000, 0)).toEqual({ text: '1.9M', chgCls: '' });
  });

  it('adds the signed percentage and direction class', () => {
    expect(formatOiWithChg(1_900_000, 1_000_000)).toEqual({ text: '1.9M (+90%)', chgCls: 'oi-history__cell--up' });
    expect(formatOiWithChg(500_000, 1_000_000)).toEqual({ text: '500K (-50%)', chgCls: 'oi-history__cell--down' });
  });
});

describe('month and date labels', () => {
  it('adds months across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });

  it('formats month and date labels', () => {
    expect(formatMonthLabel('2026-07')).toBe('July 2026');
    expect(formatMonthShortLabel('2026-07')).toBe("Jul '26");
    expect(formatFullDateLabel('2026-07-01')).toBe('Wed, Jul 1');
  });
});

describe('priceDirection', () => {
  it('averages price change across expiries with a previous close', () => {
    const data = new Map([
      ['a', { close: 110, prevClose: 100 }],
      ['b', { close: 99, prevClose: 100 }],
      ['c', { close: 50, prevClose: undefined }],
    ]);
    // (+10% - 1%) / 2 = +4.5%
    expect(priceDirection(data, ['a', 'b', 'c'])).toBe('up');
  });

  it('returns down, or null when the move is within 0.5%', () => {
    expect(priceDirection(new Map([['a', { close: 98, prevClose: 100 }]]), ['a'])).toBe('down');
    expect(priceDirection(new Map([['a', { close: 100.4, prevClose: 100 }]]), ['a'])).toBeNull();
    expect(priceDirection(new Map(), ['a'])).toBeNull();
  });
});

describe('classifyOptionMove', () => {
  it('classifies the four OI/price quadrants', () => {
    expect(classifyOptionMove(1100, 1000, 105, 100)).toBe('Long Buildup');
    expect(classifyOptionMove(1100, 1000, 95, 100)).toBe('Short Buildup');
    expect(classifyOptionMove(900, 1000, 95, 100)).toBe('Long Unwinding');
    expect(classifyOptionMove(900, 1000, 105, 100)).toBe('Short Covering');
  });

  it('is stable inside the thresholds and unknown without previous OI', () => {
    expect(classifyOptionMove(1010, 1000, 105, 100)).toBe('Stable');
    expect(classifyOptionMove(1100, 1000, 100.2, 100)).toBe('Stable');
    expect(classifyOptionMove(1100, undefined, 105, 100)).toBe('-');
    expect(classifyOptionMove(1100, 0, 105, 100)).toBe('-');
  });
});

describe('patternBiasScore', () => {
  it('scores CE and PE patterns in opposite directions', () => {
    expect(patternBiasScore('Long Buildup', 'CE')).toBe(2);
    expect(patternBiasScore('Long Buildup', 'PE')).toBe(-2);
    expect(patternBiasScore('Short Buildup', 'CE')).toBe(-2);
    expect(patternBiasScore('Short Buildup', 'PE')).toBe(2);
    expect(patternBiasScore('Short Covering', 'CE')).toBe(1);
    expect(patternBiasScore('Long Unwinding', 'PE')).toBe(1);
    expect(patternBiasScore('Stable', 'CE')).toBe(0);
  });
});

describe('pctChange / formatPct / formatPcr', () => {
  it('returns null for a non-positive start', () => {
    expect(pctChange(0, 10)).toBeNull();
    expect(pctChange(-5, 10)).toBeNull();
    expect(pctChange(200, 250)).toBe(25);
  });

  it('formats percentages with a sign and no decimals', () => {
    expect(formatPct(null)).toBe('-');
    expect(formatPct(Infinity)).toBe('-');
    expect(formatPct(12.4)).toBe('+12%');
    expect(formatPct(-3.6)).toBe('-4%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(2342050)).toBe('+2342050%');
  });

  it('formats PCR to two decimals', () => {
    expect(formatPcr(1.234)).toBe('1.23');
    expect(formatPcr(null)).toBe('-');
  });
});

describe('buildFuturesSeries', () => {
  it('sorts by date and interprets price/OI changes', () => {
    const series = buildFuturesSeries([
      futuresRow('2026-10-03', 98, 1200),   // price down, OI up
      futuresRow('2026-10-01', 100, 1000),  // first day
      futuresRow('2026-10-02', 100, 1100),  // flat price, OI up
      futuresRow('2026-10-04', 97, 1100),   // price down, OI down
      futuresRow('2026-10-05', 99, 1000),   // price up, OI down
    ]);

    expect(series.map((row) => row.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(series.map((row) => row.interpretation)).toEqual([
      'New data',
      'Long buildup',
      'Short buildup',
      'Long unwinding',
      'Short covering',
    ]);
    expect(series[0].priceChangePct).toBeNull();
    expect(series[1].oiChangePct).toBeCloseTo(10);
    expect(series[2].priceChangePct).toBeCloseTo(-2);
  });

  it('averages volume over up to the previous five sessions, ignoring zeros', () => {
    const rows = [100, 0, 300, 400, 500, 600, 700].map((volume, i) => futuresRow(`2026-10-0${i + 1}`, 100, 1000, volume));
    const series = buildFuturesSeries(rows);

    expect(series[0].avgVolume).toBeNull();
    expect(series[2].avgVolume).toBe(100);               // [100, 0]
    expect(series[6].avgVolume).toBe((300 + 400 + 500 + 600) / 4); // [0, 300, 400, 500, 600]
  });
});
