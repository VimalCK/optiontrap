import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { defaultAutomationConfig } from '../../shared/automation.js';
import type { AutoTrade } from '@/services/automation';
import { marketDate } from '../../shared/marketTime.js';
import Automation, { AutoTradesTable, TradeRangePicker, TradeRow, automationStatus } from './Automation';

describe('Automation screen', () => {
  const html = renderToStaticMarkup(<MemoryRouter><Automation /></MemoryRouter>);

  it('has the settings gear at the top right of the trades card, not in the page header, and no settings form of its own', () => {
    const firstCard = html.match(/<section class="card[ "].*?<\/section>/s)?.[0] ?? '';
    expect(firstCard).toMatch(/<h3[^>]*>Automated trades<\/h3>/);
    expect(firstCard).toMatch(/<div class="automation-section__actions">.*<button[^>]*aria-label="Algo Trading settings"/s);
    expect(html.match(/<header.*?<\/header>/s)?.[0]).not.toContain('Algo Trading settings');
    expect(html).not.toContain('automation-config');
  });

  it("shows only the trades list: no 'How a trade runs' card", () => {
    expect(html).not.toContain('How a trade runs');
    expect(html.match(/<section class="card[ "]/g)).toHaveLength(1);
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

  it('shows each trade with its horizon, side and stage, timed in IST', () => {
    const table = renderToStaticMarkup(<AutoTradesTable trades={[trade]} />);
    expect(table).toContain('<span class="automation-trades__symbol">NIFTY26NOV24000PE</span>');
    expect(table).toContain('<span class="automation-trades__symbol">NIFTY26NOV24000PE</span><span class="automation-trades__sub">Intraday</span>');
    expect(table).toContain('<span class="badge badge--negative">Sell</span>');
    expect(table).toContain('<span class="badge badge--negative">Rejected</span>');
    expect(table).not.toContain('Max open positions reached'); // the reason is in the expanded lifecycle only
    expect(table).not.toContain('>Reason<');
    expect(table).toContain('<span class="automation-trades__time">10:30</span><span class="automation-trades__sub">5 Nov</span>'); // 05:00 UTC
  });

  it('marks an open position live, and shows closed P&L in profit or loss colours', () => {
    const open = { ...trade, id: 'o', stage: 'executed' as const, reason: null, entryPrice: 100 };
    const won = { ...open, id: 'w', stage: 'closed' as const, exitPrice: 90 };
    const lost = { ...open, id: 'l', stage: 'closed' as const, exitPrice: 120 };
    const table = renderToStaticMarkup(<AutoTradesTable trades={[open, won, lost]} />);
    expect(table).toContain('<span class="badge badge--accent"><span class="badge__dot" aria-hidden="true"></span>Executed</span>');
    expect(table).toContain('<td class="automation-trades__num automation-trades__pnl--profit">+750.00</td>');
    expect(table).toContain('<td class="automation-trades__num automation-trades__pnl--loss">-1,500.00</td>');
  });

  it('has a chevron button per trade for its lifecycle, closed at first', () => {
    const table = renderToStaticMarkup(<AutoTradesTable trades={[trade]} />);
    const chevron = [...table.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('aria-label="Show lifecycle"')) ?? '';
    expect(chevron).toContain('aria-expanded="false"');
    expect(chevron).toContain('type="button"');
    expect(table).not.toContain('automation-timeline');
  });

  it("shows each trade's own fill, even when trades merge into one position", () => {
    const first = { ...trade, id: 'a', stage: 'executed' as const, reason: null, entryPrice: 1000, positionId: 'p1' };
    const second = { ...first, id: 'b', quantity: 500, entryPrice: 1010 };
    const table = renderToStaticMarkup(<AutoTradesTable trades={[first, second]} />);
    expect(table).toContain('<td class="automation-trades__num">1,000.00</td><td class="automation-trades__num">–</td>');
    expect(table).toContain('<td class="automation-trades__num">1,010.00</td><td class="automation-trades__num">–</td>');
  });
});

describe('TradeRow', () => {
  it('shows the lifecycle as a timeline of plain sentences when open, the IST time only on the row', () => {
    const trade: AutoTrade = {
      id: 't', horizon: 'intraday', kind: 'index-option', mode: 'paper', tradingsymbol: 'NIFTY26N0924550PE', instrumentToken: 1,
      side: 'SELL', quantity: 65, stage: 'executed', reason: null, entryPrice: 98.8, exitPrice: null, positionId: 'p',
      createdAt: '2026-11-06T07:00:29.000Z', updatedAt: '2026-11-06T07:00:29.000Z',
      events: [
        { stage: 'selected', at: '2026-11-06T07:00:29.000Z', detail: { strategyId: 'option-analyzer-setups', reason: 'Wall Defense · score 53' } },
        { stage: 'executed', at: '2026-11-06T07:00:29.000Z', detail: { entryPrice: 98.8 } },
      ],
    };
    const html = renderToStaticMarkup(<table><tbody><TradeRow trade={trade} open onToggle={() => {}} /></tbody></table>);
    expect(html).toContain('aria-label="Hide lifecycle"');
    expect(html).toContain('<span class="automation-trades__time">12:30</span>'); // 07:00 UTC
    expect(html.match(/<ol class="automation-timeline">.*<\/ol>/s)?.[0]).not.toMatch(/12:30|6 Nov/);
    expect(html).toContain('<p class="automation-timeline__text">Option Analyzer setups · Wall Defense · score 53</p>');
    expect(html).toContain('<p class="automation-timeline__text">Opened a paper position at ₹98.80</p>');
    expect(html).not.toContain('strategyId');
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
