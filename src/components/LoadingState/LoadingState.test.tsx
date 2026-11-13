import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LoadingState from './LoadingState';

describe('LoadingState', () => {
  it('shows a spinner with the label and announces it as a status', () => {
    const html = renderToStaticMarkup(<LoadingState label="Loading holdings…" className="x" />);
    expect(html).toContain('class="loading-state x"');
    expect(html).toContain('role="status"');
    expect(html).toContain('<span class="loading-state__spinner" aria-hidden="true"></span>');
    expect(html).toContain('<span class="loading-state__label">Loading holdings…</span>');
  });

  it('says Loading… when given no label, and drops the block padding inline', () => {
    const html = renderToStaticMarkup(<LoadingState inline />);
    expect(html).toContain('class="loading-state loading-state--inline"');
    expect(html).toContain('>Loading…</span>');
  });
});
