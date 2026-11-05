import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { defaultAutomationConfig } from '../../shared/automation.js';
import type { AutoTrade } from '@/services/automation';
import Automation, { AutoTradesTable, LifecycleSteps, automationStatus } from './Automation';

describe('Automation screen', () => {
  const html = renderToStaticMarkup(<MemoryRouter><Automation /></MemoryRouter>);

  it('has the settings gear at the top of the first card, not in the page header, and no settings form of its own', () => {
    const firstCard = html.match(/<section class="card".*?<\/section>/s)?.[0] ?? '';
    expect(firstCard).toMatch(/<div class="automation-section__head"><h3[^>]*>How a trade runs<\/h3><button[^>]*aria-label="Automation settings"/);
    expect(html.match(/<header.*?<\/header>/s)?.[0]).not.toContain('Automation settings');
    expect(html).not.toContain('automation-config');
  });

  it('shows how a trade runs and the trades list', () => {
    expect(html).toContain('How a trade runs');
    expect(html).toContain('Automated trades');
  });
});

describe('automationStatus', () => {
  it('says on or off, and that nothing trades yet', () => {
    expect(automationStatus(null)).toBe('Loading…');
    expect(automationStatus(defaultAutomationConfig())).toBe('Off · engine not built yet, nothing trades');
    expect(automationStatus({ ...defaultAutomationConfig(), enabled: true })).toBe('On · engine not built yet, nothing trades');
  });
});

describe('LifecycleSteps', () => {
  it('shows selection, validation, execution and completion in order', () => {
    const steps = renderToStaticMarkup(<LifecycleSteps />);
    expect([...steps.matchAll(/<strong>(\w+)<\/strong>/g)].map((m) => m[1])).toEqual(['Selection', 'Validation', 'Execution', 'Completion']);
  });
});

describe('AutoTradesTable', () => {
  const trade: AutoTrade = {
    id: 't1', horizon: 'intraday', kind: 'index-option', mode: 'paper', tradingsymbol: 'NIFTY26NOV24000PE',
    instrumentToken: 1, side: 'SELL', quantity: 75, stage: 'rejected', reason: 'Max open positions reached',
    positionId: null, createdAt: '2026-11-05T05:00:00.000Z', updatedAt: '2026-11-05T05:00:00.000Z',
    events: [],
  };

  it('says there are no trades yet', () => {
    expect(renderToStaticMarkup(<AutoTradesTable trades={[]} />)).toContain('No automated trades yet');
  });

  it('shows each trade with its stage and reason, timed in IST', () => {
    const table = renderToStaticMarkup(<AutoTradesTable trades={[trade]} />);
    expect(table).toContain('NIFTY26NOV24000PE');
    expect(table).toContain('Index option');
    expect(table).toContain('automation-stage--rejected">Rejected<');
    expect(table).toContain('Max open positions reached');
    expect(table).toContain('10:30'); // 05:00 UTC
  });
});
