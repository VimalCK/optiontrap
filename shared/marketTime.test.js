import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MARKET_TIME_ZONE,
  addDays,
  daysBetween,
  daysUntil,
  isMarketOpen,
  isTradingDay,
  lastSessionEnd,
  marketClock,
  marketCloseTime,
  marketDate,
  marketDateTime,
  marketDayStartMs,
  marketMonth,
  marketStatus,
  marketTimeLabel,
} from './marketTime.js';

// IST is UTC+05:30. 07:35 in Ireland (GMT) on Tue 3 Nov 2026 is 13:05 IST.
const utc = (iso) => new Date(`${iso}Z`);

describe('marketClock', () => {
  it('reads the market-zone date, weekday and time, not the machine zone', () => {
    expect(marketClock(utc('2026-11-03T07:35:00'))).toEqual({ date: '2026-11-03', weekday: 2, minutes: 13 * 60 + 5 });
    expect(marketTimeLabel(utc('2026-11-03T07:35:00'))).toBe('13:05');
    expect(marketTimeLabel(utc('2026-11-03T18:30:00'))).toBe('00:00');
  });

  it('rolls over to the next market day before UTC does', () => {
    // 20:00 GMT Tue is 01:30 IST Wed
    expect(marketDate(utc('2026-11-03T20:00:00'))).toBe('2026-11-04');
    expect(marketMonth(utc('2026-11-30T19:00:00'))).toBe('2026-12');
  });
});

describe('market instants', () => {
  it('turns a market date and time into the right instant', () => {
    expect(marketDateTime('2026-11-03', 9 * 60 + 15).toISOString()).toBe('2026-11-03T03:45:00.000Z');
    expect(marketCloseTime('2026-11-03').toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(marketDateTime('2026-11-03T00:00:00').toISOString()).toBe('2026-11-02T18:30:00.000Z');
  });

  it('gives an Invalid Date for an empty or bad date instead of throwing (pages render before data loads)', () => {
    expect(Number.isNaN(marketCloseTime('').getTime())).toBe(true);
    expect(Number.isNaN(marketDateTime('not-a-date', 60).getTime())).toBe(true);
  });

  it('finds the start of the market day containing a timestamp', () => {
    const start = Date.parse('2026-11-02T18:30:00Z'); // 00:00 IST, 3 Nov
    expect(marketDayStartMs(Date.parse('2026-11-03T07:35:00Z'))).toBe(start);
    expect(marketDayStartMs(start)).toBe(start);
    expect(marketDayStartMs(start - 1)).toBe(start - 24 * 60 * 60 * 1000);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-11-03', '2026-11-10')).toBe(7);
  });

  it('counts days to a date from the market-zone today', () => {
    expect(daysUntil('2026-11-03', utc('2026-11-03T07:35:00'))).toBe(0);
    expect(daysUntil('2026-11-03', utc('2026-11-03T20:00:00'))).toBe(-1); // already 4 Nov in India
  });
});

describe('trading days and session', () => {
  it('skips weekends and exchange holidays', () => {
    expect(isTradingDay('2026-11-03')).toBe(true);
    expect(isTradingDay('2026-11-07')).toBe(false); // Saturday
    expect(isTradingDay('2026-11-10')).toBe(false); // Diwali Balipratipada
  });

  it('reports pre-open, live, post-close and closed by market time', () => {
    expect(marketStatus(utc('2026-11-03T03:29:00'))).toBe('closed');     // 08:59
    expect(marketStatus(utc('2026-11-03T03:30:00'))).toBe('pre-open');   // 09:00
    expect(marketStatus(utc('2026-11-03T03:45:00'))).toBe('live');       // 09:15
    expect(marketStatus(utc('2026-11-03T10:00:00'))).toBe('live');       // 15:30
    expect(marketStatus(utc('2026-11-03T10:01:00'))).toBe('post-close'); // 15:31
    expect(marketStatus(utc('2026-11-03T10:31:00'))).toBe('closed');     // 16:01
    expect(marketStatus(utc('2026-11-10T05:00:00'))).toBe('closed');     // holiday
    expect(isMarketOpen(utc('2026-11-03T07:35:00'))).toBe(true);
  });
});

describe('lastSessionEnd', () => {
  it("is today's session end (15:31 IST) once it has passed, else the previous trading day's", () => {
    expect(lastSessionEnd(new Date('2026-11-05T10:01:00Z')).toISOString()).toBe('2026-11-05T10:01:00.000Z'); // Thu 15:31 IST: today's
    expect(lastSessionEnd(new Date('2026-11-05T10:00:59Z')).toISOString()).toBe('2026-11-04T10:01:00.000Z'); // Thu 15:30:59 IST, still open: Wed's
    expect(lastSessionEnd(new Date('2026-11-05T02:00:00Z')).toISOString()).toBe('2026-11-04T10:01:00.000Z'); // Thu 07:30 IST: Wed's
  });

  it('skips weekends back to Friday', () => {
    expect(lastSessionEnd(new Date('2026-11-09T04:00:00Z')).toISOString()).toBe('2026-11-06T10:01:00.000Z'); // Mon 09:30 IST: Fri's
    expect(lastSessionEnd(new Date('2026-11-08T06:30:00Z')).toISOString()).toBe('2026-11-06T10:01:00.000Z'); // Sun 12:00 IST: Fri's
  });
});

describe('single source of the market time zone', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SKIP = new Set(['node_modules', 'dist', '.git']);

  function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (SKIP.has(entry.name)) return [];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(js|ts|tsx|sql)$/.test(entry.name) && !/\.test\.(js|ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it('is named only in shared/marketTime.js', () => {
    const offenders = ['src', 'server', 'shared']
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .filter((file) => !file.endsWith(path.join('shared', 'marketTime.js')))
      .filter((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return text.includes(MARKET_TIME_ZONE) || /\+05:30|5\.5 \* 60/.test(text);
      })
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
