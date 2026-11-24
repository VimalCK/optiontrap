import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../../shared/automation.js';
import type { AutomationConfig } from '@/services/automation';
import { TEST_STRATEGIES } from '@/services/strategies.fixture';
import AutomationConfigForm, { type AutomationConfigFormProps } from './AutomationConfigForm';
import { StrategyRulesTab } from '@/utils/uiEnums';

const noop = () => {};
const [STRATEGY] = TEST_STRATEGIES;
const form = (config: AutomationConfig, extra: Partial<AutomationConfigFormProps> = {}) =>
  renderToStaticMarkup(<AutomationConfigForm config={config} strategy={STRATEGY} onChange={noop} {...extra} />);

/** The tag of the toggle labelled `label`, as rendered. */
const toggle = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label}"`)) ?? '';

describe('AutomationConfigForm', () => {
  it('shows the strategy with its Active switch, its setting tiles, then Entry rules and Exit rules tabs', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES));
    expect(html).toContain('<h2 class="automation-strategy__name">Option Analyzer setups</h2>');
    expect(toggle(html, 'Option Analyzer setups active')).not.toBe('');
    const tiles = [...html.matchAll(/<div class="automation-tile" role="group" aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(tiles).toEqual(['Execution', 'Trades', 'Signal filters']);
    for (const label of ['Min score (of 100)', 'Min premium (₹)']) expect(html).toContain(label);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs.map((t) => t.match(/<span class="tab-bar__text">(.*?)<\/span>/)?.[1])).toEqual(['Entry rules', 'Exit rules']);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(html.indexOf('Min premium')).toBeLessThan(html.indexOf('role="tablist"'));
  });

  it("counts each rule tab's active rules", () => {
    const config = defaultAutomationConfig(TEST_STRATEGIES);
    const [firstEntry] = Object.keys(config.entryRules);
    const [firstExit, secondExit] = Object.keys(config.exitRules);
    for (const id of Object.keys(config.entryRules)) config.entryRules[id].active = id === firstEntry;
    for (const id of Object.keys(config.exitRules)) config.exitRules[id].active = id === firstExit || id === secondExit;
    const tabs = [...form(config).matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs.map((t) => t.match(/<span class="automation-count" aria-label="(\d+) active">/)?.[1])).toEqual(['1', '2']);
  });

  it('shows one rule tab at a time', () => {
    const entry = form(defaultAutomationConfig(TEST_STRATEGIES));
    expect(entry).toContain('Max lots per trade');
    expect(entry).not.toContain('Stop-loss');

    const exit = form(defaultAutomationConfig(TEST_STRATEGIES), { initialRulesTab: StrategyRulesTab.ExitRules });
    for (const label of ['Stop-loss', 'Target', 'Square off at']) expect(exit).toContain(label);
    expect(exit).not.toContain('Max lots per trade');
  });

  it('has no trade-type table and no Algo Trading switch of its own', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES));
    expect(html).not.toContain('Trade type');
    expect(toggle(html, 'Buy Index option')).toBe('');
    expect(toggle(html, 'Algo Trading')).toBe('');
  });

  it('offers live trading and positional trades only as unavailable', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES));
    expect(toggle(html, 'Live trading')).toContain('disabled');
    expect(toggle(html, 'Live trading')).toContain('aria-checked="false"');
    expect(toggle(html, 'Paper trading')).not.toContain('disabled');
    expect(toggle(html, 'Paper trading')).toContain('aria-checked="true"');
    expect(html).toContain('<small class="automation-tile__hint">Live trading · not available yet</small>');
    expect(toggle(html, 'Positional')).toContain('disabled');
    expect(toggle(html, 'Intraday')).toContain('aria-checked="true"');
    expect(toggle(html, 'Intraday')).not.toContain('disabled');
  });

  it('uses toggles, not checkboxes, for every on/off choice', () => {
    expect(form(defaultAutomationConfig(TEST_STRATEGIES))).not.toContain('type="checkbox"');
  });

  it('has no Save or Cancel of its own: the settings page has one for every strategy', () => {
    const html = form(defaultAutomationConfig(TEST_STRATEGIES));
    expect(html).not.toContain('>Save<');
    expect(html).not.toContain('>Cancel<');
  });
});
