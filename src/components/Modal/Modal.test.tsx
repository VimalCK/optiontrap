import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModalSize } from '@/utils/uiEnums';
import Modal, { closesModal } from './Modal';

const noop = () => {};
const tag = (html: string, className: string) => html.match(new RegExp(`<[a-z0-9]+[^>]*class="${className}[" ][^>]*>`))?.[0] ?? '';

describe('Modal', () => {
  it('is a labelled dialog on the blurred backdrop, with a title row, close button and body', () => {
    const html = renderToStaticMarkup(<Modal title="Create Price Alert" subtitle="INFY" onClose={noop}><p>Fields</p></Modal>);
    const dialog = tag(html, 'modal modal--small');
    expect(html.startsWith('<div class="modal-overlay">')).toBe(true);
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    const titleId = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(html).toContain(`<h2 id="${titleId}" class="modal__title">Create Price Alert</h2>`);
    expect(html).toContain('<div class="modal__subtitle">INFY</div>');
    expect(tag(html, 'app-btn app-btn--icon icon-button modal__close')).toContain('aria-label="Close"');
    expect(html).toContain('<div class="modal__body"><p>Fields</p></div>');
  });

  it('draws only the header parts and footer it is given', () => {
    const bare = renderToStaticMarkup(<Modal title="Delete" onClose={noop}>Body</Modal>);
    for (const part of ['modal__eyebrow', 'modal__subtitle', 'modal__leading', 'modal__aside', 'modal__footer']) expect(bare).not.toContain(part);

    const full = renderToStaticMarkup(
      <Modal title="Send feedback" eyebrow="Help" leading={<i>A</i>} titleExtras={<b>X</b>} aside={<u>P</u>}
        footer={<button type="button">Send</button>} size={ModalSize.Large} className="feedback-modal" onClose={noop}>Body</Modal>,
    );
    expect(tag(full, 'modal modal--large feedback-modal')).toContain('role="dialog"');
    expect(full).toContain('<span class="modal__eyebrow">Help</span>');
    expect(full).toContain('<div class="modal__leading"><i>A</i></div>');
    expect(full).toMatch(/<\/h2><b>X<\/b><\/div>/);
    expect(full).toContain('<div class="modal__aside"><u>P</u></div>');
    expect(full).toContain('<div class="modal__footer"><button type="button">Send</button></div>');
  });

  it('closes on Escape, unless a control inside already used the key', () => {
    expect(closesModal({ key: 'Escape', defaultPrevented: false })).toBe(true);
    expect(closesModal({ key: 'Escape', defaultPrevented: true })).toBe(false);
    expect(closesModal({ key: 'Enter', defaultPrevented: false })).toBe(false);
  });
});
