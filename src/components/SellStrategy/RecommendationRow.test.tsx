import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecommendationRow from './RecommendationRow';
import type { StrategySetup } from './strategySetups';
import { TradingMode } from '../../../shared/tradeEnums.js';
import { OptionSetup, SetupPattern } from '../../../shared/analysisEnums.js';

const buyCall = {
  type: OptionSetup.BuyCe,
  strikes: [25050],
  premium: 85,
  score: 88,
  pattern: SetupPattern.Momentum,
  winChance: 43,
  breakdown: { direction: 36, today: 12, flow: 25, breakout: 15 },
  reasons: { direction: ['Day leans bullish (+0.70) · with this trade'], today: [], flow: ['CE long buildup on 3/8 strikes'], breakout: [] },
} as StrategySetup;

const render = (props: Partial<React.ComponentProps<typeof RecommendationRow>> = {}) => renderToStaticMarkup(
  <RecommendationRow rec={buyCall} spot={25010} orderMode={TradingMode.Paper} expiry="2026-11-24" autoPick={false} expanded={false} onToggle={() => {}} onTrade={() => {}} {...props} />,
);

describe('RecommendationRow', () => {
  it('trades the setup\'s own side and shows its breakeven', () => {
    const html = render();
    expect(html).toContain('>Buy</button>');
    expect(html).toContain('BE 25,135 · +125');
    expect(html).not.toContain('Auto pick');
  });

  it('marks the automation\'s pick', () => {
    expect(render({ autoPick: true })).toContain('Auto pick');
  });

  it('opens the score details from a labelled button, each part with its own reasons', () => {
    const closed = render();
    expect(closed).toMatch(/<button[^>]*aria-label="Show the score details"[^>]*aria-expanded="false"/);
    const open = render({ expanded: true });
    expect(open).toContain('Strongest part · ');
    expect(open).toContain('25/25');
    expect(open).toContain('CE long buildup on 3/8 strikes');
  });
});
