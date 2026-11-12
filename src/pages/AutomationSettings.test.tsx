import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AutomationSettings, { sectionFromParams } from './AutomationSettings';
import { AutomationSettingsSection } from '@/utils/uiEnums';

describe('AutomationSettings', () => {
  it('has General, Strategies, Entry rules and Exit rules tabs as its first row, General picked by default', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AutomationSettings /></MemoryRouter>);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs.map((t) => t.replace(/<[^>]+>/g, ''))).toEqual(['General', 'Strategies', 'Entry rules', 'Exit rules']);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf('class="card'));
  });

  it('has one Save / Cancel for every tab, at the bottom of the one card, Save off until the settings load', () => {
    for (const url of ['/automation/settings', '/automation/settings?tab=EntryRules', '/automation/settings?tab=ExitRules']) {
      const html = renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><AutomationSettings /></MemoryRouter>);
      const card = html.match(/<section class="card automation-settings__card">.*<\/section>/s)?.[0] ?? '';
      expect(html.match(/class="form-footer"/g)).toHaveLength(1);
      expect(card).toMatch(/<div class="automation-settings__body">.*<\/div><div class="form-footer">.*<\/div><\/section>$/s);
      expect(card.match(/<button[^>]*>Save<\/button>/)?.[0]).toContain('disabled');
      expect(card.match(/<button[^>]*>Cancel<\/button>/)?.[0]).not.toContain('disabled');
    }
  });

  it('opens the tab named in the URL, and General for anything else', () => {
    expect(sectionFromParams(new URLSearchParams('tab=EntryRules'))).toBe(AutomationSettingsSection.EntryRules);
    expect(sectionFromParams(new URLSearchParams('tab=ExitRules'))).toBe(AutomationSettingsSection.ExitRules);
    expect(sectionFromParams(new URLSearchParams('tab=Strategies'))).toBe(AutomationSettingsSection.Strategies);
    expect(sectionFromParams(new URLSearchParams('tab=nope'))).toBe(AutomationSettingsSection.General);
    expect(sectionFromParams(new URLSearchParams(''))).toBe(AutomationSettingsSection.General);
  });

  it('still opens links saved before the tabs were enums', () => {
    expect(sectionFromParams(new URLSearchParams('tab=entry-rules'))).toBe(AutomationSettingsSection.EntryRules);
    expect(sectionFromParams(new URLSearchParams('tab=exit-rules'))).toBe(AutomationSettingsSection.ExitRules);
    expect(sectionFromParams(new URLSearchParams('tab=general'))).toBe(AutomationSettingsSection.General);
  });
});
