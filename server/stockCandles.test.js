import { describe, it, expect } from 'vitest';
import { completedCandles, historyRewritten, lastSettledAt } from './stockCandles.js';

// IST is UTC+05:30: 10:15 UTC is the 15:45 IST settle time.
const utc = (iso) => new Date(`${iso}Z`);
const settled = (now) => new Date(lastSettledAt(utc(now))).toISOString();

describe('lastSettledAt', () => {
  it("is today's 15:45 IST once it has passed on a weekday", () => {
    expect(settled('2026-10-29T10:30:00')).toBe('2026-10-29T10:15:00.000Z'); // Thu 16:00 IST
  });

  it('is the previous weekday before the close and over weekends', () => {
    expect(settled('2026-10-29T08:30:00')).toBe('2026-10-28T10:15:00.000Z'); // Thu 14:00 IST → Wed
    expect(settled('2026-11-02T03:30:00')).toBe('2026-10-30T10:15:00.000Z'); // Mon 09:00 IST → Fri
    expect(settled('2026-11-01T06:00:00')).toBe('2026-10-30T10:15:00.000Z'); // Sun → Fri
  });
});

describe('completedCandles', () => {
  const candles = [{ date: '2026-10-28', close: 1 }, { date: '2026-10-29', close: 2 }];

  it("drops today's candle until the close has settled", () => {
    expect(completedCandles(candles, utc('2026-10-29T08:30:00')).map((c) => c.date)).toEqual(['2026-10-28']);
    expect(completedCandles(candles, utc('2026-10-29T10:30:00')).map((c) => c.date)).toEqual(['2026-10-28', '2026-10-29']);
  });
});

describe('historyRewritten', () => {
  const stored = [{ date: '2026-10-27', close: 1000 }, { date: '2026-10-28', close: 1010 }];

  it('ignores tiny corrections and new days', () => {
    expect(historyRewritten(stored, [{ date: '2026-10-28', close: 1010.5 }, { date: '2026-10-29', close: 990 }])).toBe(false);
  });

  it('flags a split: stored closes no longer match', () => {
    expect(historyRewritten(stored, [{ date: '2026-10-27', close: 500 }, { date: '2026-10-28', close: 505 }])).toBe(true);
  });
});
