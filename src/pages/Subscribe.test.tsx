import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Subscribe from './Subscribe';

// A static render runs no effects: it is the page before the plans arrive.
describe('Subscribe while the plans load', () => {
  it('shows three plan cards in outline, not a spinner', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Subscribe /></MemoryRouter>);
    expect(html).toMatch(/class="shimmer-group__label"[^>]*>Loading plans</);
    expect(html.match(/<div class="subscribe-plan">/g)).toHaveLength(3);
    expect(html).not.toContain('Loading plans…');
  });
});
