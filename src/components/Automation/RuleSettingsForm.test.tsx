import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENTRY_RULES } from '../../../shared/entryRules/index.js';
import { EXIT_RULES } from '../../../shared/exitRules/index.js';
import { defaultRuleSettings } from '../../../shared/rules/ruleSettings.js';
import type { RuleInfo, RuleSettings } from '../../../shared/rules/ruleSettings.js';
import RuleSettingsForm, { paramValueFromInput } from './RuleSettingsForm';

const form = (rules: RuleInfo[], settings: RuleSettings = defaultRuleSettings(rules)) =>
  renderToStaticMarkup(<RuleSettingsForm rules={rules} settings={settings} onChange={() => {}} label="Some rules" description="How they are used." />);
const toggleFor = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label} active"`)) ?? '';
const inputsOf = (html: string, type: string) => [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(`type="${type}"`));

describe('RuleSettingsForm', () => {
  it('lists every rule it is given, each with its own toggle, and says how they are used', () => {
    for (const rules of [ENTRY_RULES, EXIT_RULES]) {
      const html = form(rules);
      for (const rule of rules) {
        expect(html).toContain(rule.label);
        expect(toggleFor(html, rule.label)).not.toBe('');
      }
      expect(html).toContain('aria-label="Some rules"');
      expect(html).toContain('How they are used.');
      expect(html).not.toContain('type="checkbox"');
    }
  });

  it('hides a value label the rule name already gives, keeping it as the input name, and shows the others', () => {
    const rules: RuleInfo[] = [
      { id: 'max', label: 'Maximum size', description: '', params: [{ key: 'max', label: 'Size', type: 'count', hideLabel: true }] },
      { id: 'loss', label: 'Loss', description: '', params: [{ key: 'amount', label: 'Loss (₹)', type: 'amount' }] },
    ];
    const html = form(rules);
    const [size, loss] = [...html.matchAll(/<label class="automation-rule__param">(.*?)<input([^>]*)>/g)];
    expect(size[1]).toBe('');
    expect(size[2]).toContain('aria-label="Size"');
    expect(loss[1]).toBe('Loss (₹)');
    expect(loss[2]).not.toContain('aria-label');
  });

  it('shows every rule inactive by default, with empty values', () => {
    const html = form(ENTRY_RULES);
    expect(html).not.toContain('>Active</span>');
    expect(html.match(/<span class="toggle__text">Inactive<\/span>/g)).toHaveLength(ENTRY_RULES.length);
    for (const tag of inputsOf(html, 'number')) expect(tag).toContain('value=""');
  });

  it('shows a time as a time input, with its default filled in', () => {
    const html = form(EXIT_RULES);
    expect(inputsOf(html, 'time')).toHaveLength(1);
    expect(inputsOf(html, 'time')[0]).toContain('value="15:00"');
  });

  it('shows an active rule as active, with its values', () => {
    const settings = defaultRuleSettings(EXIT_RULES);
    settings['stop-loss'] = { active: true, params: { percent: 20 } };
    settings.target = { active: false, params: { percent: 40 } };
    const html = form(EXIT_RULES, settings);
    expect(toggleFor(html, 'Stop-loss')).toContain('aria-checked="true"');
    expect(toggleFor(html, 'Target')).toContain('aria-checked="false"');
    expect(html).toContain('<span class="toggle__text">Active</span>');
    expect(inputsOf(html, 'number').some((tag) => tag.includes('value="20"'))).toBe(true);
    expect(inputsOf(html, 'number').some((tag) => tag.includes('value="40"'))).toBe(true);
  });
});

describe('paramValueFromInput', () => {
  it('keeps what was typed: empty is not set, numbers as numbers, times as text', () => {
    expect(paramValueFromInput('count', '')).toBeNull();
    expect(paramValueFromInput('count', '1.5')).toBe(1.5);
    expect(paramValueFromInput('amount', '2500')).toBe(2500);
    expect(paramValueFromInput('time', '15:00')).toBe('15:00');
    expect(paramValueFromInput('time', '')).toBeNull();
  });
});
