import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AppSelect from './AppSelect';

const OPTIONS = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
const trigger = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? '';

describe('AppSelect', () => {
  it('names the trigger with ariaLabel when given', () => {
    const html = renderToStaticMarkup(<AppSelect value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Underlying" />);
    expect(trigger(html)).toContain('aria-label="Underlying"');
    expect(html).toContain('Alpha');
  });

  it('adds no aria-label without one, so a wrapping label names it', () => {
    const html = renderToStaticMarkup(<AppSelect value="b" options={OPTIONS} onChange={() => {}} />);
    expect(trigger(html)).not.toContain('aria-label');
    expect(html).toContain('Beta');
  });
});
