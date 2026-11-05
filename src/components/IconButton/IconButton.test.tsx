import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InfoIcon, SettingsIcon } from '@/components/icons/Icons';
import IconButton from './IconButton';

const noop = () => {};
/** The opening <button> tag, as rendered. */
const buttonTag = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? '';

describe('IconButton', () => {
  it('is a plain button whose label is both the tooltip and the accessible name', () => {
    const tag = buttonTag(renderToStaticMarkup(<IconButton icon={<SettingsIcon />} label="Automation settings" onClick={noop} />));
    expect(tag).toContain('type="button"');
    expect(tag).toContain('class="app-btn app-btn--icon icon-button"');
    expect(tag).toContain('title="Automation settings"');
    expect(tag).toContain('aria-label="Automation settings"');
    expect(tag).not.toContain('aria-expanded');
    expect(tag).not.toContain('disabled');
  });

  it('shows the icon, hidden from screen readers', () => {
    const html = renderToStaticMarkup(<IconButton icon={<InfoIcon />} label="Explain" onClick={noop} />);
    expect(html).toMatch(/<button[^>]*><svg[^>]*aria-hidden="true"/);
  });

  it('says whether the panel it toggles is open', () => {
    expect(buttonTag(renderToStaticMarkup(<IconButton icon={<InfoIcon />} label="Explain" onClick={noop} expanded />)))
      .toContain('aria-expanded="true"');
    expect(buttonTag(renderToStaticMarkup(<IconButton icon={<InfoIcon />} label="Explain" onClick={noop} expanded={false} />)))
      .toContain('aria-expanded="false"');
  });

  it('can be disabled and take an extra class', () => {
    const tag = buttonTag(renderToStaticMarkup(<IconButton icon={<InfoIcon />} label="Explain" onClick={noop} disabled className="extra" />));
    expect(tag).toContain('disabled');
    expect(tag).toContain('class="app-btn app-btn--icon icon-button extra"');
  });
});
