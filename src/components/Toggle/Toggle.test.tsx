import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Toggle from './Toggle';

const render = (props: Partial<React.ComponentProps<typeof Toggle>> = {}) =>
  renderToStaticMarkup(<Toggle checked={false} onChange={() => {}} label="Max lots per trade" {...props} />);
const button = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? '';

describe('Toggle', () => {
  it('is a named switch button that says whether it is on', () => {
    const off = button(render());
    expect(off).toContain('type="button"');
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('aria-label="Max lots per trade"');
    expect(off).toContain('title="Max lots per trade"');
    expect(button(render({ checked: true }))).toContain('aria-checked="true"');
    expect(button(render({ checked: true }))).toContain('class="toggle toggle--on"');
  });

  it('shows On / Off by default, or the text given for each state', () => {
    expect(render()).toContain('<span class="toggle__text">Off</span>');
    expect(render({ checked: true })).toContain('<span class="toggle__text">On</span>');
    expect(render({ checked: true, onText: 'Active', offText: 'Inactive' })).toContain('>Active</span>');
    expect(render({ onText: 'Active', offText: 'Inactive' })).toContain('>Inactive</span>');
  });

  it('shows no text when the text is empty, e.g. under a table column heading', () => {
    expect(render({ onText: '', offText: '' })).not.toContain('toggle__text');
  });

  it('can be disabled', () => {
    expect(button(render({ disabled: true }))).toContain('disabled');
  });
});
