import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../../shared/automation.js';
import type { StrategySettings } from '@/services/automation';
import { TEST_STRATEGIES } from '@/services/strategies.fixture';
import AutomationConfigForm, { strategyState, type AutomationConfigFormProps } from './AutomationConfigForm';
import { StrategyRulesTab } from '@/utils/uiEnums';

const noop = () => {};
const [STRATEGY] = TEST_STRATEGIES;
/** The strategy's default settings: inactive, on paper, intraday, every rule off. */
const defaults = (): StrategySettings => defaultAutomationConfig(TEST_STRATEGIES).strategies[STRATEGY.id];
const form = (settings: StrategySettings = defaults(), extra: Partial<AutomationConfigFormProps> = {}) =>
  renderToStaticMarkup(<AutomationConfigForm strategy={STRATEGY} settings={settings} onChange={noop} algoTradingOn {...extra} />);

/** The tag of the toggle labelled `label`, as rendered. */
const toggle = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label}"`)) ?? '';

describe('strategyState', () => {
  it('is on only while both Algo Trading and the strategy are on, else says which to switch on', () => {
    expect(strategyState(true, true)).toEqual({ on: true, reason: null });
    expect(strategyState(true, false)).toEqual({ on: false, reason: 'Switch it on in Settings' });
    expect(strategyState(false, true)).toEqual({ on: false, reason: 'Algo Trading is off in Settings' });
    expect(strategyState(false, false)).toEqual({ on: false, reason: 'Algo Trading is off in Settings' });
  });
});

describe('AutomationConfigForm', () => {
  it('shows the strategy with whether it is on, its setting tiles, then Entry rules and Exit rules tabs', () => {
    const html = form(defaults());
    expect(html).toContain('<h2 class="automation-strategy__name">Option Analyzer setups</h2>');
    expect(html).toContain('aria-label="Option Analyzer setups off"');
    expect(html).toContain('Switch it on in Settings');
    expect(toggle(html, 'Option Analyzer setups active')).toBe('');
    const tiles = [...html.matchAll(/<div class="automation-tile" role="group" aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(tiles).toEqual(['Execution', 'Trades', 'Signal filters']);
    for (const label of ['Min score (of 100)', 'Min premium (₹)']) expect(html).toContain(label);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs.map((t) => t.match(/<span class="tab-bar__text">(.*?)<\/span>/)?.[1])).toEqual(['Entry rules', 'Exit rules']);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(html.indexOf('Min premium')).toBeLessThan(html.indexOf('role="tablist"'));
  });

  it("counts each rule tab's active rules", () => {
    const settings = defaults();
    const [firstEntry] = Object.keys(settings.entryRules);
    const [firstExit, secondExit] = Object.keys(settings.exitRules);
    for (const id of Object.keys(settings.entryRules)) settings.entryRules[id].active = id === firstEntry;
    for (const id of Object.keys(settings.exitRules)) settings.exitRules[id].active = id === firstExit || id === secondExit;
    const tabs = [...form(settings).matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs.map((t) => t.match(/<span class="automation-count" aria-label="(\d+) active">/)?.[1])).toEqual(['1', '2']);
  });

  it('shows one rule tab at a time', () => {
    const entry = form(defaults());
    expect(entry).toContain('Max lots per trade');
    expect(entry).not.toContain('Stop-loss');

    const exit = form(defaults(), { initialRulesTab: StrategyRulesTab.ExitRules });
    for (const label of ['Stop-loss', 'Target', 'Square off at']) expect(exit).toContain(label);
    expect(exit).not.toContain('Max lots per trade');
  });

  it('has no trade-type table and no Algo Trading switch of its own', () => {
    const html = form(defaults());
    expect(html).not.toContain('Trade type');
    expect(toggle(html, 'Buy Index option')).toBe('');
    expect(toggle(html, 'Algo Trading')).toBe('');
  });

  it("shows the strategy's own execution switches as stored", () => {
    const settings = defaults();
    settings.execution.Paper = false;
    expect(toggle(form(settings), 'Paper trading')).toContain('aria-checked="false"');
  });

  it("leaves the general rules to the page's All strategies section", () => {
    const html = form(defaults(), { initialRulesTab: StrategyRulesTab.EntryRules });
    expect(html).not.toContain('Maximum open positions');
    expect(form(defaults(), { initialRulesTab: StrategyRulesTab.ExitRules })).not.toContain('Max loss per day');
  });

  it('offers live trading and positional trades only as unavailable', () => {
    const html = form(defaults());
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
    expect(form(defaults())).not.toContain('type="checkbox"');
  });

  it('has no Save or Cancel of its own: the settings page has one for every strategy', () => {
    const html = form(defaults());
    expect(html).not.toContain('>Save<');
    expect(html).not.toContain('>Cancel<');
  });

  it("locks every setting while Algo Trading or the strategy is off, but the rule tabs can still be read", () => {
    const fieldsets = (html: string) => [...html.matchAll(/<fieldset[^>]*>/g)].map((m) => m[0]);
    const active = { ...defaults(), active: true };
    for (const off of [form(active, { algoTradingOn: false }), form({ ...active, active: false })]) {
      expect(fieldsets(off)).toHaveLength(2);
      for (const tag of fieldsets(off)) expect(tag).toContain('disabled=""');
      const tablist = off.slice(off.indexOf('role="tablist"'));
      expect(tablist.slice(0, tablist.indexOf('<fieldset'))).not.toContain('disabled');
    }
    for (const tag of fieldsets(form(active))) expect(tag).not.toContain('disabled');
  });
});
