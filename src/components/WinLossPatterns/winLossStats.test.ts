import { describe, it, expect } from 'vitest';
import {
  averageLoss, averagePnl, averageWin, dailyBars, dayLabel, entrySlotLabel, exitRuleLabel, profitFactor, setupName, strategyName,
  winRate, withRunningTotal,
} from './winLossStats';
import type { ResultGroup } from '@/services/automation';

const group = <K,>(key: K, extra: Partial<ResultGroup<K>> = {}): ResultGroup<K> => ({
  key, trades: 4, wins: 3, losses: 1, pnl: 1500, grossProfit: 3000, grossLoss: 1500, best: 1500, worst: -1500, ...extra,
});

describe('ratios', () => {
  it('works out win rate, averages and profit factor from the totals', () => {
    const g = group(null);
    expect(winRate(g)).toBe(75);
    expect(averagePnl(g)).toBe(375);
    expect(averageWin(g)).toBe(1000);
    expect(averageLoss(g)).toBe(-1500);
    expect(profitFactor(g)).toBe(2);
  });

  it('has no value where it would divide by zero', () => {
    const none = group(null, { trades: 0, wins: 0, losses: 0, pnl: 0, grossProfit: 0, grossLoss: 0 });
    expect([winRate(none), averagePnl(none), averageWin(none), averageLoss(none), profitFactor(none)]).toEqual([null, null, null, null, null]);
    expect(profitFactor(group(null, { losses: 0, grossLoss: 0 }))).toBeNull(); // nothing lost
  });
});

describe('labels', () => {
  it('names exits by their rule, and a manual exit', () => {
    expect(exitRuleLabel('stop-loss')).toBe('Stop-loss');
    expect(exitRuleLabel('max-daily-loss')).toBe('Max loss per day');
    expect(exitRuleLabel(null)).toBe('Exited manually');
  });

  it('names strategies and setups, and the ones recorded without one', () => {
    expect(strategyName('option-analyzer-setups')).toBe('Option Analyzer setups');
    expect(strategyName(null)).toBe('Unknown');
    expect(setupName('Bull put')).toBe('Bull put');
    expect(setupName(null)).toBe('Unknown');
  });

  it('shows an entry slot as its IST time span, and a day with its weekday', () => {
    expect(entrySlotLabel(570)).toBe('09:30–10:00');
    expect(entrySlotLabel(900)).toBe('15:00–15:30');
    expect(dayLabel('2026-11-09')).toBe('Mon, 9 Nov');
  });
});

describe('withRunningTotal', () => {
  it('adds each day to the total so far, oldest first', () => {
    const days = withRunningTotal([group('2026-11-09', { pnl: 1000 }), group('2026-11-10', { pnl: -1500 }), group('2026-11-11', { pnl: 200 })]);
    expect(days.map((d) => d.total)).toEqual([1000, -500, -300]);
  });
});

describe('dailyBars', () => {
  const day = (n: number, pnl: number) => group(`2026-10-${String(n).padStart(2, '0')}`, { pnl });

  it('sizes each day against the biggest day, up or down, and keeps the running total', () => {
    const bars = dailyBars([day(1, 500), day(2, -2000), day(3, 1000)]);
    expect(bars.map((b) => b.height)).toEqual([25, 100, 50]);
    expect(bars.map((b) => b.total)).toEqual([500, -1500, -500]);
  });

  it('labels every day up to ten, else every nth counting back from the last', () => {
    expect(dailyBars([day(1, 1), day(2, 1)]).every((b) => b.labelled)).toBe(true);
    const many = dailyBars(Array.from({ length: 22 }, (_, i) => day(i + 1, 100)));
    expect(many.filter((b) => b.labelled).length).toBeLessThanOrEqual(10);
    expect(many[21].labelled).toBe(true);
  });

  it('has flat bars when every day broke even', () => {
    expect(dailyBars([day(1, 0)])[0].height).toBe(0);
  });
});
