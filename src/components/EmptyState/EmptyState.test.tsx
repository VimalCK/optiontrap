import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('shows the icon as decoration, with the title and description as text', () => {
    const html = renderToStaticMarkup(<EmptyState icon={<svg />} title="Nothing yet" description="It will show here." className="x" />);
    expect(html).toContain('class="empty-state x"');
    expect(html).toMatch(/<div class="empty-state__art" aria-hidden="true">.*<svg><\/svg>/);
    expect(html).toContain('<p class="empty-state__title">Nothing yet</p>');
    expect(html).toContain('<p class="empty-state__description">It will show here.</p>');
  });

  it('leaves out the description when there is none', () => {
    expect(renderToStaticMarkup(<EmptyState icon={<svg />} title="Nothing yet" />)).not.toContain('empty-state__description');
  });
});
