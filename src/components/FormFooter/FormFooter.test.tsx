import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FormFooter, { type FormFooterProps } from './FormFooter';

const noop = () => {};
const render = (props: Partial<FormFooterProps> = {}) =>
  renderToStaticMarkup(<FormFooter onSave={noop} onCancel={noop} saving={false} error={null} {...props} />);
const button = (html: string, text: string) => html.match(new RegExp(`<button[^>]*>${text}</button>`))?.[0] ?? '';

describe('FormFooter', () => {
  it('has Cancel and Save, both usable', () => {
    const html = render();
    expect(button(html, 'Cancel')).toContain('type="button"');
    expect(button(html, 'Save')).toContain('app-btn--primary');
    expect(button(html, 'Save')).not.toContain('disabled');
    expect(button(html, 'Cancel')).not.toContain('disabled');
  });

  it('disables both while saving, and Save alone when it says so', () => {
    const busy = render({ saving: true });
    expect(button(busy, 'Saving…')).toContain('disabled');
    expect(button(busy, 'Cancel')).toContain('disabled');

    const notReady = render({ saveDisabled: true });
    expect(button(notReady, 'Save')).toContain('disabled');
    expect(button(notReady, 'Cancel')).not.toContain('disabled');
  });

  it('turns the Save button into a disabled "Saved" after a save, with no extra text beside it', () => {
    const saved = render({ saved: true });
    expect(button(saved, 'Saved')).toContain('disabled');
    expect(button(saved, 'Cancel')).not.toContain('disabled');
    expect(saved.match(/Saved/g)).toHaveLength(1);
    expect(button(render(), 'Save')).not.toBe('');
    expect(button(render({ saved: true, error: 'Could not save' }), 'Save')).not.toContain('disabled');
  });

  it('shows why a save failed', () => {
    expect(render({ error: 'Max loss per day: set Loss (₹) to make it active' }))
      .toContain('Max loss per day: set Loss (₹) to make it active');
  });
});
