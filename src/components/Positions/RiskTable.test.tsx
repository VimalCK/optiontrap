import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RiskTable from './RiskTable';
import { paperTabs } from './PaperPositions';
import { breakevenLabel, maxLossLabel, maxProfitLabel } from './riskLabels';
import type { LegRisk, RiskGroup } from '@/services/positionRisk';
import { PaperTab } from '@/utils/uiEnums';

/** A short put spread on NIFTY for 26 Nov, with these changes. */
const group = (changes: Partial<RiskGroup> = {}): RiskGroup => ({
  key: 'NIFTY|2026-11-26',
  underlying: 'NIFTY',
  expiry: '2026-11-26',
  legs: [
    { position: { strike: 24000, optionType: 'PE' }, ltp: 120, pnl: -750, invalidationHit: false } as unknown as LegRisk,
    { position: { strike: 23800, optionType: 'PE' }, ltp: 60, pnl: 300, invalidationHit: false } as unknown as LegRisk,
  ],
  livePnL: -450,
  maxLoss: -11250,
  maxProfit: 3750,
  breakevens: [23950],
  invalidationHit: false,
  ...changes,
});

describe('paperTabs', () => {
  it('names the paper tabs, Open, Pending and Position Risk, with how many each holds', () => {
    expect(paperTabs(2, 1, 3)).toEqual([
      { id: PaperTab.Positions, label: 'Open (2)' },
      { id: PaperTab.Orders, label: 'Pending (1)' },
      { id: PaperTab.Risk, label: 'Position Risk (3)' },
    ]);
  });
});

describe('risk labels', () => {
  it('shows max loss and profit in rupees, Unlimited when unbounded, and — when there is none', () => {
    expect(maxLossLabel(group())).toBe('-11,250.00');
    expect(maxLossLabel(group({ maxLoss: null }))).toBe('Unlimited');
    expect(maxLossLabel(group({ maxLoss: 0 }))).toBe('—');
    expect(maxProfitLabel(group())).toBe('+3,750.00');
    expect(maxProfitLabel(group({ maxProfit: null }))).toBe('Unlimited');
    expect(maxProfitLabel(group({ maxProfit: 0 }))).toBe('—');
  });

  it('lists the breakevens, or — when the payoff never crosses zero', () => {
    expect(breakevenLabel(group({ breakevens: [23950, 24250] }))).toBe('23,950 / 24,250');
    expect(breakevenLabel(group({ breakevens: [] }))).toBe('—');
  });
});

describe('RiskTable', () => {
  const render = (groups: RiskGroup[]) => renderToStaticMarkup(<RiskTable groups={groups} spotPrices={new Map()} />);

  it('shows one clickable row per strategy, with its metrics', () => {
    const html = render([group(), group({ key: 'BANKNIFTY|2026-11-26', underlying: 'BANKNIFTY' })]);
    const rows = html.match(/<tr[^>]*class="risk-table__row[^"]*"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('role="button"');
    expect(rows[0]).toContain('tabindex="0"');
    expect(html).toContain('2 legs');
    expect(html).toContain('-450.00');
    expect(html).toContain('23,950');
  });

  it('marks a strategy whose leg hit its invalidation level, naming the leg', () => {
    const legs = group().legs.map((leg, i) => ({ ...leg, invalidationHit: i === 0 }));
    const html = render([group({ legs, invalidationHit: true })]);
    expect(html).toContain('risk-table__row--invalidated');
    expect(html).toContain('Invalidation hit:');
    expect(html).toContain('24000PE');
  });

  it('says so when there is nothing to assess', () => {
    expect(render([])).toContain('No open option positions to assess.');
  });
});
