import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../../shared/automation.js';
import type { AutomationConfig } from '@/services/automation';
import AutomationConfigForm, { type AutomationConfigFormProps } from './AutomationConfigForm';

const noop = () => {};
const form = (config: AutomationConfig, extra: Partial<AutomationConfigFormProps> = {}) =>
  renderToStaticMarkup(
    <AutomationConfigForm config={config} section="general" onChange={noop} {...extra} />,
  );

/** The tag of the toggle labelled `label`, as rendered. */
const toggle = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label}"`)) ?? '';

describe('AutomationConfigForm', () => {
  it('lists every trade type with a Buy and a Sell toggle', () => {
    const html = form(defaultAutomationConfig());
    for (const kind of ['Stock', 'Stock option', 'Stock future', 'Index option', 'Index future']) {
      expect(toggle(html, `Buy ${kind}`)).not.toBe('');
      expect(toggle(html, `Sell ${kind}`)).not.toBe('');
    }
  });

  it('switches on exactly the trade types and sides that are on', () => {
    const config = defaultAutomationConfig();
    config.kinds['index-option'].SELL = true;
    const html = form(config);
    expect(toggle(html, 'Sell Index option')).toContain('aria-checked="true"');
    expect(toggle(html, 'Buy Index option')).toContain('aria-checked="false"');
    expect(html.match(/aria-checked="true"[^>]*aria-label="(Buy|Sell) [^"]+"/g)).toHaveLength(1);
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
    expect(toggle(html, 'Positional')).toContain('disabled');
    expect(toggle(html, 'Intraday')).toContain('aria-checked="true"');
    expect(toggle(html, 'Intraday')).not.toContain('disabled');
  });

  it('uses toggles, not checkboxes, for every on/off choice', () => {
    expect(form(defaultAutomationConfig())).not.toContain('type="checkbox"');
  });

  it('says whether automation is on or off, with a toggle', () => {
    const toggle = (html: string) => html.match(/<button[^>]*role="switch"[^>]*aria-label="Automation"[^>]*>/)?.[0] ?? '';
    expect(toggle(form(defaultAutomationConfig()))).toContain('aria-checked="false"');
    expect(form(defaultAutomationConfig())).toContain('<span class="toggle__text">Off</span>');
    expect(toggle(form({ ...defaultAutomationConfig(), enabled: true }))).toContain('aria-checked="true"');
  });

  it('shows one section at a time: General without the rules, Validations with only the rules', () => {
    const general = form(defaultAutomationConfig());
    expect(general).toContain('Buy Stock');
    expect(general).not.toContain('Max lots per trade');

    const validations = form(defaultAutomationConfig(), { section: 'validations' });
    expect(validations).toContain('Max lots per trade');
    expect(validations).not.toContain('Buy Stock');
    expect(validations).not.toContain('aria-label="Automation"');
  });

  it('has no Save or Cancel of its own: the settings page has one for every tab', () => {
    expect(form(defaultAutomationConfig())).not.toContain('>Save<');
    expect(form(defaultAutomationConfig(), { section: 'validations' })).not.toContain('>Cancel<');
  });
});
