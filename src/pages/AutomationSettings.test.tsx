import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AutomationSettings, { sectionFromParams } from './AutomationSettings';

describe('AutomationSettings', () => {
  it('has General and Validations tabs as its first row, General picked by default', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AutomationSettings /></MemoryRouter>);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs.map((t) => t.replace(/<[^>]+>/g, ''))).toEqual(['General', 'Validations']);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf('class="card'));
  });

  it('has one Save / Cancel for every tab, at the bottom of the one card, Save off until the settings load', () => {
    for (const url of ['/automation/settings', '/automation/settings?tab=validations']) {
      const html = renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><AutomationSettings /></MemoryRouter>);
      const card = html.match(/<section class="card automation-settings__card">.*<\/section>/s)?.[0] ?? '';
      expect(html.match(/class="form-footer"/g)).toHaveLength(1);
      expect(card).toMatch(/<div class="automation-settings__body">.*<\/div><div class="form-footer">.*<\/div><\/section>$/s);
      expect(card.match(/<button[^>]*>Save<\/button>/)?.[0]).toContain('disabled');
      expect(card.match(/<button[^>]*>Cancel<\/button>/)?.[0]).not.toContain('disabled');
    }
  });

  it('opens the tab named in the URL, and General for anything else', () => {
    expect(sectionFromParams(new URLSearchParams('tab=validations'))).toBe('validations');
    expect(sectionFromParams(new URLSearchParams('tab=general'))).toBe('general');
    expect(sectionFromParams(new URLSearchParams('tab=nope'))).toBe('general');
    expect(sectionFromParams(new URLSearchParams(''))).toBe('general');
  });
});
