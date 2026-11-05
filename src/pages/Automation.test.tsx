import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../shared/automation.js';
import type { AutomationConfig, AutoTrade } from '@/services/automation';
import { AutomationConfigForm, AutoTradesTable, LifecycleSteps } from './Automation';

const noop = () => {};
const form = (config: AutomationConfig, extra: Partial<React.ComponentProps<typeof AutomationConfigForm>> = {}) =>
  renderToStaticMarkup(
    <AutomationConfigForm config={config} onChange={noop} onSave={noop} saving={false} dirty={false} message={null} {...extra} />,
  );

/** The checkbox labelled `label`, as rendered. */
const checkbox = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

describe('AutomationConfigForm', () => {
  it('lists every trade type with a Buy and a Sell box', () => {
    const html = form(defaultAutomationConfig());
    for (const kind of ['Stock', 'Stock option', 'Stock future', 'Index option', 'Index future']) {
      expect(checkbox(html, `Buy ${kind}`)).not.toBe('');
      expect(checkbox(html, `Sell ${kind}`)).not.toBe('');
    }
  });

  it('ticks exactly the trade types and sides that are on', () => {
    const config = defaultAutomationConfig();
    config.kinds['index-option'].SELL = true;
    const html = form(config);
    expect(checkbox(html, 'Sell Index option')).toContain('checked');
    expect(checkbox(html, 'Buy Index option')).not.toContain('checked');
    expect(html.match(/aria-label="(Buy|Sell) [^"]+" checked/g)).toHaveLength(1);
  });

  it('offers live trading and positional trades only as unavailable', () => {
    const html = form(defaultAutomationConfig());
    const live = html.match(/<input[^>]*value="live"[^>]*>/)?.[0] ?? '';
    const paper = html.match(/<input[^>]*value="paper"[^>]*>/)?.[0] ?? '';
    expect(live).toContain('disabled');
    expect(paper).not.toContain('disabled');
    expect(paper).toContain('checked');
    expect(html).toContain('Live trading<small> · not available yet</small>');
    expect(html).toContain('later, from OI history');
  });

  it('says whether automation is on or off', () => {
    expect(form(defaultAutomationConfig())).toContain('Automation off');
    expect(form({ ...defaultAutomationConfig(), enabled: true })).toContain('Automation on');
  });

  it('only lets you save changes, and shows the result', () => {
    expect(form(defaultAutomationConfig())).toMatch(/<button[^>]*disabled[^>]*>Save</);
    expect(form(defaultAutomationConfig(), { dirty: true })).toMatch(/<button class="app-btn app-btn--primary">Save</);
    expect(form(defaultAutomationConfig(), { message: { tone: 'error', text: 'Live trading is not available yet' } }))
      .toContain('Live trading is not available yet');
  });
});

describe('LifecycleSteps', () => {
  it('shows selection, validation, execution and completion in order', () => {
    const html = renderToStaticMarkup(<LifecycleSteps />);
    expect([...html.matchAll(/<strong>(\w+)<\/strong>/g)].map((m) => m[1])).toEqual(['Selection', 'Validation', 'Execution', 'Completion']);
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
    const html = renderToStaticMarkup(<AutoTradesTable trades={[trade]} />);
    expect(html).toContain('NIFTY26NOV24000PE');
    expect(html).toContain('Index option');
    expect(html).toContain('automation-stage--rejected">Rejected<');
    expect(html).toContain('Max open positions reached');
    expect(html).toContain('10:30'); // 05:00 UTC
  });
});
