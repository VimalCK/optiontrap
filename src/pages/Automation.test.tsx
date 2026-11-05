import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { defaultAutomationConfig } from '../../shared/automation.js';
import type { AutoTrade } from '@/services/automation';
import { marketDate } from '../../shared/marketTime.js';
import Automation, { AutoTradesTable, TradeRangePicker, automationStatus } from './Automation';

describe('Automation screen', () => {
  const html = renderToStaticMarkup(<MemoryRouter><Automation /></MemoryRouter>);

  it('has the settings gear at the top right of the trades card, not in the page header, and no settings form of its own', () => {
    const firstCard = html.match(/<section class="card".*?<\/section>/s)?.[0] ?? '';
    expect(firstCard).toMatch(/<h3[^>]*>Automated trades<\/h3>/);
    expect(firstCard).toMatch(/<div class="automation-section__actions">.*<button[^>]*aria-label="Automation settings"/s);
    expect(html.match(/<header.*?<\/header>/s)?.[0]).not.toContain('Automation settings');
    expect(html).not.toContain('automation-config');
  });

  it("shows only the trades list: no 'How a trade runs' card", () => {
    expect(html).not.toContain('How a trade runs');
    expect(html.match(/<section class="card"/g)).toHaveLength(1);
  });

  it("opens the trades list on today's trades, From and To both today", () => {
    const today = marketDate();
    const dates = [...html.matchAll(/<input[^>]*type="date"[^>]*>/g)].map((m) => m[0].match(/value="([^"]*)"/)?.[1]);
    expect(dates).toEqual([today, today]);
  });
});

describe('automationStatus', () => {
  it('says on or off, and that nothing trades while there are no strategies', () => {
    expect(automationStatus(null)).toBe('Loading…');
    expect(automationStatus(defaultAutomationConfig(), [])).toBe('Off · no strategies yet, nothing trades');
    expect(automationStatus({ ...defaultAutomationConfig(), enabled: true }, [])).toBe('On · no strategies yet, nothing trades');
  });

  it('says no strategy is active by default', () => {
    expect(automationStatus(defaultAutomationConfig())).toBe('Off · no strategy active');
  });

  it('counts the active strategies once there are some', () => {
    const strategies = [{ id: 'a' }, { id: 'b' }];
    const config = (active: string[]) => ({
      ...defaultAutomationConfig(),
      enabled: true,
      strategies: Object.fromEntries(strategies.map((s) => [s.id, { active: active.includes(s.id), params: {} }])),
    });
    expect(automationStatus(config([]), strategies)).toBe('On · no strategy active');
    expect(automationStatus(config(['a']), strategies)).toBe('On · 1 strategy active');
    expect(automationStatus(config(['a', 'b']), strategies)).toBe('On · 2 strategies active');
  });
});

describe('AutoTradesTable', () => {
  const trade: AutoTrade = {
    id: 't1', horizon: 'intraday', kind: 'index-option', mode: 'paper', tradingsymbol: 'NIFTY26NOV24000PE',
    instrumentToken: 1, side: 'SELL', quantity: 75, stage: 'rejected', reason: 'Max open positions reached',
    entryPrice: null, exitPrice: null, positionId: null, createdAt: '2026-11-05T05:00:00.000Z', updatedAt: '2026-11-05T05:00:00.000Z',
    events: [],
  };

  it('says there are no trades yet', () => {
    expect(renderToStaticMarkup(<AutoTradesTable trades={[]} />)).toContain('No automated trades in this range');
  });

  it('shows each trade with its stage and reason, timed in IST', () => {
    const table = renderToStaticMarkup(<AutoTradesTable trades={[trade]} />);
    expect(table).toContain('NIFTY26NOV24000PE');
    expect(table).toContain('Index option');
    expect(table).toContain('automation-stage--rejected">Rejected<');
    expect(table).toContain('Max open positions reached');
    expect(table).toContain('10:30'); // 05:00 UTC
  });

  it("shows each trade's own fill, even when trades merge into one position", () => {
    const first = { ...trade, id: 'a', stage: 'executed' as const, reason: null, entryPrice: 1000, positionId: 'p1' };
    const second = { ...first, id: 'b', quantity: 500, entryPrice: 1010 };
    const table = renderToStaticMarkup(<AutoTradesTable trades={[first, second]} />);
    expect(table).toContain('<td>1,000.00</td><td>–</td>');
    expect(table).toContain('<td>1,010.00</td><td>–</td>');
  });
});

describe('TradeRangePicker', () => {
  const html = renderToStaticMarkup(<TradeRangePicker range={{ from: '2026-11-01', to: '2026-11-05' }} onChange={() => {}} />);
  const input = (label: string) => html.match(new RegExp(`${label}<input[^>]*>`))?.[0] ?? '';

  it("shows the range picked, and won't let To go before From", () => {
    expect(input('From')).toContain('value="2026-11-01"');
    expect(input('From')).toContain('max="2026-11-05"');
    expect(input('To')).toContain('value="2026-11-05"');
    expect(input('To')).toContain('min="2026-11-01"');
  });

  it('has only the two date pickers, no shortcut buttons', () => {
    expect(html).not.toContain('<button');
  });
});

describe('AutoTradesTable controls', () => {
  it("shows the range controls in the card's header, and says when the range has no trades", () => {
    const html = renderToStaticMarkup(<AutoTradesTable trades={[]} controls={<span id="controls" />} />);
    expect(html).toMatch(/<div class="automation-section__head"><h3[^>]*>Automated trades<\/h3><span id="controls"><\/span><\/div>/);
    expect(html).toContain('No automated trades in this range');
  });
});
