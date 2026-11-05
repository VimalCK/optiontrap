import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../../shared/automation.js';
import type { AutomationConfig } from '@/services/automation';
import AutomationConfigForm, { type AutomationConfigFormProps } from './AutomationConfigForm';

const noop = () => {};
const form = (config: AutomationConfig, extra: Partial<AutomationConfigFormProps> = {}) =>
  renderToStaticMarkup(
    <AutomationConfigForm config={config} onChange={noop} onSave={noop} onCancel={noop} saving={false} error={null} {...extra} />,
  );

/** The tag of the checkbox labelled `label`, as rendered. */
const checkbox = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

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
    expect(form(defaultAutomationConfig())).toContain('<span>Off</span>');
    expect(form({ ...defaultAutomationConfig(), enabled: true })).toContain('<span>On</span>');
  });

  it('has Save and Cancel, both usable until a save is under way', () => {
    const html = form(defaultAutomationConfig());
    expect(button(html, 'Save')).not.toContain('disabled');
    expect(button(html, 'Cancel')).not.toContain('disabled');

    const busy = form(defaultAutomationConfig(), { saving: true });
    expect(button(busy, 'Saving…')).toContain('disabled');
    expect(button(busy, 'Cancel')).toContain('disabled');
  });

  it('shows why a save failed', () => {
    expect(form(defaultAutomationConfig(), { error: 'Live trading is not available yet' }))
      .toContain('Live trading is not available yet');
  });
});
