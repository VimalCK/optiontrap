import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Badge from './Badge';
import { Tone } from '@/utils/uiEnums';

describe('Badge', () => {
  it('shows its text in the tone asked for', () => {
    expect(renderToStaticMarkup(<Badge tone={Tone.Negative}>Sell</Badge>)).toBe('<span class="badge badge--negative">Sell</span>');
  });

  it('adds a hidden dot, an accessible label and extra classes when asked', () => {
    const html = renderToStaticMarkup(<Badge tone={Tone.Accent} dot label="Stage: Executed" className="x">Executed</Badge>);
    expect(html).toContain('class="badge badge--accent x"');
    expect(html).toContain('aria-label="Stage: Executed"');
    expect(html).toContain('<span class="badge__dot" aria-hidden="true"></span>Executed');
  });
});
