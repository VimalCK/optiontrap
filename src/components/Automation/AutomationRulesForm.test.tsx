import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTOMATION_RULES, defaultRuleSettings } from '../../../shared/automationRules/index.js';
import AutomationRulesForm, { paramValueFromInput } from './AutomationRulesForm';

const form = (rules = defaultRuleSettings()) => renderToStaticMarkup(<AutomationRulesForm rules={rules} onChange={() => {}} />);
const toggleFor = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label} active"`)) ?? '';
const inputsOf = (html: string, type: string) => [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(`type="${type}"`));

describe('AutomationRulesForm', () => {
  it('lists every rule from the rule list, each with its own toggle', () => {
    const html = form();
    for (const rule of AUTOMATION_RULES) {
      expect(html).toContain(rule.label);
      expect(toggleFor(html, rule.label)).not.toBe('');
    }
    expect(html).not.toContain('type="checkbox"');
  });

  it('shows every rule inactive with empty values by default', () => {
    const html = form();
    expect(html).not.toContain('>Active</span>');
    expect(html.match(/<span class="toggle__text">Inactive<\/span>/g)).toHaveLength(AUTOMATION_RULES.length);
    for (const tag of inputsOf(html, 'number')) expect(tag).toContain('value=""');
  });

  it('shows an active rule as active, with its values', () => {
    const rules = defaultRuleSettings();
    rules['max-lots'] = { active: true, params: { max: 2 } };
    rules['max-daily-loss'] = { active: false, params: { amount: 2500 } };
    const html = form(rules);
    expect(toggleFor(html, 'Max lots per trade')).toContain('aria-checked="true"');
    expect(toggleFor(html, 'Max loss per day')).toContain('aria-checked="false"');
    expect(html).toContain('<span class="toggle__text">Active</span>');
    expect(inputsOf(html, 'number').some((tag) => tag.includes('value="2"'))).toBe(true);
    expect(inputsOf(html, 'number').some((tag) => tag.includes('value="2500"'))).toBe(true);
  });
});

describe('paramValueFromInput', () => {
  it('keeps what was typed: empty is not set, anything else as the number typed', () => {
    expect(paramValueFromInput('')).toBeNull();
    expect(paramValueFromInput('1.5')).toBe(1.5);
  });
});
