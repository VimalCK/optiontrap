import { describe, it, expect } from 'vitest';
import type { TradeSetupChecklistItem } from './types';
import { readinessScore, sortChecklistByStatus, checklistStatusText, setupReadinessLabel, setupReadinessWidth, distancePct, summarizeTradeLevels } from './tradeSetup';

const item = (status: TradeSetupChecklistItem['status'], label: string = status): TradeSetupChecklistItem => ({ label, status, answer: '' });

describe('checklist helpers', () => {
  it('scores pass as 1 and warn as 0.5', () => {
    expect(readinessScore([])).toBe(0);
    expect(readinessScore([item('Pass'), item('Warn'), item('Fail')])).toBe(50);
    expect(readinessScore([item('Pass'), item('Pass'), item('Warn')])).toBe(83);
  });

  it('sorts pass, warn, fail without mutating the input', () => {
    const items = [item('Fail', 'a'), item('Pass', 'b'), item('Warn', 'c'), item('Pass', 'd')];
    expect(sortChecklistByStatus(items).map((i) => i.label)).toEqual(['b', 'd', 'c', 'a']);
    expect(items.map((i) => i.label)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('labels statuses and readiness', () => {
    expect(checklistStatusText('Pass')).toBe('Yes');
    expect(checklistStatusText('Warn')).toBe('Wait');
    expect(checklistStatusText('Fail')).toBe('No');
    expect(setupReadinessLabel('Avoid', 80)).toBe('No setup');
    expect(setupReadinessLabel('Watch', 80)).toBe('80%');
    expect(setupReadinessWidth('Avoid', 80)).toBe('0%');
    expect(setupReadinessWidth('Confirmed', 95)).toBe('95%');
  });
});

describe('distancePct', () => {
  it('returns null for missing values', () => {
    expect(distancePct(null, 100)).toBeNull();
    expect(distancePct(0, 100)).toBeNull();
    expect(distancePct(100, null)).toBeNull();
    expect(distancePct(100, 101)).toBeCloseTo(1);
  });
});

describe('summarizeTradeLevels', () => {
  const rows = [
    { strike: 22300, ceConsolidatedOi: 0, peConsolidatedOi: 900 },
    { strike: 22400, ceConsolidatedOi: 100, peConsolidatedOi: 1500 },
    { strike: 22500, ceConsolidatedOi: 2000, peConsolidatedOi: 300 },
    { strike: 22600, ceConsolidatedOi: 1200, peConsolidatedOi: 0 },
  ];

  it('picks support from PE OI below spot and resistance from CE OI above', () => {
    const result = summarizeTradeLevels(rows, 22450, 22450);
    expect(result.supportStrike).toBe(22400);
    expect(result.resistanceStrike).toBe(22500);
    expect(result.maxOiStrike).toBe(22500);
    expect(result.locationStatus).toBe('Pass');
    expect(result.riskRewardStatus).toBe('Pass');
  });

  it('grades a strike far from spot', () => {
    // 22600 is ~0.67% above 22450 → warn; 22700 is ~1.1% → fail
    expect(summarizeTradeLevels(rows, 22450, 22600).locationStatus).toBe('Warn');
    expect(summarizeTradeLevels(rows, 22450, 22700).locationStatus).toBe('Fail');
  });

  it('warns when spot or rows are missing', () => {
    expect(summarizeTradeLevels(rows, null, 22500)).toMatchObject({ locationStatus: 'Warn', supportStrike: null });
    expect(summarizeTradeLevels([], 22450, 22500)).toMatchObject({ riskRewardStatus: 'Warn', maxOiStrike: null });
  });
});
