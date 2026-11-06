import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Badge from './Badge';

describe('Badge', () => {
  it('shows its text in the tone asked for', () => {
    expect(renderToStaticMarkup(<Badge tone="negative">Sell</Badge>)).toBe('<span class="badge badge--negative">Sell</span>');
  });

  it('adds a hidden dot, an accessible label and extra classes when asked', () => {
    const html = renderToStaticMarkup(<Badge tone="accent" dot label="Stage: Executed" className="x">Executed</Badge>);
    expect(html).toContain('class="badge badge--accent x"');
    expect(html).toContain('aria-label="Stage: Executed"');
    expect(html).toContain('<span class="badge__dot" aria-hidden="true"></span>Executed');
  });
});
