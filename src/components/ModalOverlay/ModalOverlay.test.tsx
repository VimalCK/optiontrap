import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModalOverlay from './ModalOverlay';

describe('ModalOverlay', () => {
  it('wraps the popup in the shared blurred backdrop', () => {
    const html = renderToStaticMarkup(<ModalOverlay onClose={vi.fn()}><div role="dialog">Popup</div></ModalOverlay>);
    expect(html).toBe('<div class="modal-overlay"><div role="dialog">Popup</div></div>');
  });

  it('closes on a press on the backdrop, not on one inside the popup', () => {
    const onClose = vi.fn();
    const overlay = ModalOverlay({ onClose, children: null }) as React.ReactElement<{ onMouseDown: (e: { target: unknown; currentTarget: unknown }) => void }>;
    const backdrop = {};
    overlay.props.onMouseDown({ target: {}, currentTarget: backdrop });
    expect(onClose).not.toHaveBeenCalled();
    overlay.props.onMouseDown({ target: backdrop, currentTarget: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
