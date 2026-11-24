import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AutomationSettings, { strategyFromParams } from './AutomationSettings';
import { TEST_STRATEGIES } from '@/services/strategies.fixture';
import type { StrategyInfo } from '@/services/strategies';

const OTHER: StrategyInfo = { ...TEST_STRATEGIES[0], id: 'other-strategy', label: 'Other strategy' };

describe('AutomationSettings', () => {
  it('has a title row above the card, then its strategy tabs at the top of the card', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AutomationSettings /></MemoryRouter>);
    expect(html.indexOf('<h1 class="automation-header__title">Trading Strategies</h1>')).toBeGreaterThan(-1);
    expect(html.indexOf('automation-header__title')).toBeLessThan(html.indexOf('class="card'));
    expect(html).toContain('aria-label="Strategies"');
    expect(html.indexOf('class="card')).toBeLessThan(html.indexOf('aria-label="Strategies"'));
    expect(html.indexOf('aria-label="Strategies"')).toBeLessThan(html.indexOf('automation-settings__body'));
  });

  it('has one Save / Cancel for every strategy, at the bottom of the one card, Save off until the settings load', () => {
    for (const url of ['/automation/settings', `/automation/settings?strategy=${TEST_STRATEGIES[0].id}`]) {
      const html = renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><AutomationSettings /></MemoryRouter>);
      const card = html.match(/<section class="card automation-settings__card"[^>]*>.*<\/section>/s)?.[0] ?? '';
      expect(html.match(/class="form-footer"/g)).toHaveLength(1);
      expect(card).toMatch(/<div class="automation-settings__body">.*<\/div><div class="form-footer">.*<\/div><\/section>$/s);
      expect(card.match(/<button[^>]*>Save<\/button>/)?.[0]).toContain('disabled');
      expect(card.match(/<button[^>]*>Cancel<\/button>/)?.[0]).not.toContain('disabled');
    }
  });

  it('opens the strategy named in the URL, and the first one for anything else', () => {
    const strategies = [...TEST_STRATEGIES, OTHER];
    expect(strategyFromParams(new URLSearchParams('strategy=other-strategy'), strategies)).toBe(OTHER);
    expect(strategyFromParams(new URLSearchParams('strategy=nope'), strategies)).toBe(TEST_STRATEGIES[0]);
    expect(strategyFromParams(new URLSearchParams(''), strategies)).toBe(TEST_STRATEGIES[0]);
    expect(strategyFromParams(new URLSearchParams(''), [])).toBeNull();
  });
});
