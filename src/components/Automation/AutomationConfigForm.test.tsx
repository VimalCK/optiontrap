import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../../shared/automation.js';
import type { AutomationConfig } from '@/services/automation';
import { TEST_STRATEGIES } from '@/services/strategies.fixture';
import AutomationConfigForm, { type AutomationConfigFormProps } from './AutomationConfigForm';

const noop = () => {};
const form = (config: AutomationConfig, extra: Partial<AutomationConfigFormProps> = {}) =>
  renderToStaticMarkup(
    <AutomationConfigForm config={config} strategies={TEST_STRATEGIES} section="general" onChange={noop} {...extra} />,
  );

/** The tag of the toggle labelled `label`, as rendered. */
const toggle = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label}"`)) ?? '';

describe('AutomationConfigForm', () => {
  it('lists every trade type with a Buy and a Sell toggle', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES));
    for (const kind of ['Stock', 'Stock option', 'Stock future', 'Index option', 'Index future']) {
      expect(toggle(html, `Buy ${kind}`)).not.toBe('');
      expect(toggle(html, `Sell ${kind}`)).not.toBe('');
    }
  });

  it('switches on exactly the trade types and sides that are on', () => {
    const config = defaultAutomationConfig(TEST_STRATEGIES);
    config.kinds.IndexOption.SELL = true;
    const html = form(config);
    expect(toggle(html, 'Sell Index option')).toContain('aria-checked="true"');
    expect(toggle(html, 'Buy Index option')).toContain('aria-checked="false"');
    expect(html.match(/aria-checked="true"[^>]*aria-label="(Buy|Sell) [^"]+"/g)).toHaveLength(1);
  });

  it('offers live trading and positional trades only as unavailable', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES));
    const live = html.match(/<input[^>]*value="Live"[^>]*>/)?.[0] ?? '';
    const paper = html.match(/<input[^>]*value="Paper"[^>]*>/)?.[0] ?? '';
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
    expect(form(defaultAutomationConfig(TEST_STRATEGIES))).not.toContain('type="checkbox"');
  });

  it('says whether automation is on or off, with a toggle', () => {
    const toggle = (html: string) => html.match(/<button[^>]*role="switch"[^>]*aria-label="Algo Trading"[^>]*>/)?.[0] ?? '';
    expect(toggle(form(defaultAutomationConfig(TEST_STRATEGIES)))).toContain('aria-checked="false"');
    expect(form(defaultAutomationConfig(TEST_STRATEGIES))).toContain('<span class="toggle__text">Off</span>');
    expect(toggle(form({ ...defaultAutomationConfig(TEST_STRATEGIES), enabled: true }))).toContain('aria-checked="true"');
  });

  it('shows one section at a time: General, Entry rules or Exit rules', () => {
    const general = form(defaultAutomationConfig(TEST_STRATEGIES));
    expect(general).toContain('Buy Stock');
    expect(general).not.toContain('Max lots per trade');

    const entryRulesTab = form(defaultAutomationConfig(TEST_STRATEGIES), { section: 'entry-rules' });
    expect(entryRulesTab).toContain('Max lots per trade');
    expect(entryRulesTab).not.toContain('Buy Stock');
    expect(entryRulesTab).not.toContain('aria-label="Algo Trading"');
    expect(entryRulesTab).not.toContain('Stop-loss');

    const exitRulesTab = form(defaultAutomationConfig(TEST_STRATEGIES), { section: 'exit-rules' });
    for (const label of ['Stop-loss', 'Target', 'Square off at']) expect(exitRulesTab).toContain(label);
    expect(exitRulesTab).not.toContain('Max lots per trade');
    expect(exitRulesTab).not.toContain('Buy Stock');
  });

  it('lists the strategies on the Strategies tab, with their minimums', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES), { section: 'strategies' });
    for (const label of ['Option Analyzer setups', 'Min score (of 100)', 'Min premium (₹)']) expect(html).toContain(label);
    expect(html).not.toContain('No strategies yet');
    expect(html).not.toContain('Buy Stock');
  });

  it('has no Save or Cancel of its own: the settings page has one for every tab', () => {
    expect(form(defaultAutomationConfig(TEST_STRATEGIES))).not.toContain('>Save<');
    expect(form(defaultAutomationConfig(TEST_STRATEGIES), { section: 'entry-rules' })).not.toContain('>Cancel<');
  });
});
