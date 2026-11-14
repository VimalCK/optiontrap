import React, { useCallback, useEffect, useId } from 'react';
import IconButton from '@/components/IconButton/IconButton';
import { CloseIcon } from '@/components/icons/Icons';
import ModalOverlay from '@/components/ModalOverlay/ModalOverlay';
import { ModalSize, type ModalSizeId } from '@/utils/uiEnums';
import './Modal.css';

export interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  size?: ModalSizeId;
  /** A small accent label above the title. */
  eyebrow?: React.ReactNode;
  /** A line under the title. */
  subtitle?: React.ReactNode;
  /** An avatar or icon before the title. */
  leading?: React.ReactNode;
  /** Controls on the title's line, right after it (a chart link, a view toggle). */
  titleExtras?: React.ReactNode;
  /** Content on the right of the header, before the close button (a price). */
  aside?: React.ReactNode;
  /** The row under the body: the popup's actions or a note. */
  footer?: React.ReactNode;
  /** The panel's own modifier class, for a look only this popup has. */
  className?: string;
  children: React.ReactNode;
}

/** Escape closes the popup, unless a control inside used it (an open dropdown marks it handled). */
export const closesModal = (e: Pick<React.KeyboardEvent, 'key' | 'defaultPrevented'>) => e.key === 'Escape' && !e.defaultPrevented;

const Modal: React.FC<ModalProps> = ({
  title, onClose, size = ModalSize.Small, eyebrow, subtitle, leading, titleExtras, aside, footer, className, children,
}) => {
  const titleId = useId();
  // Focus once when it opens, so Escape reaches it, unless a field inside already took focus (autoFocus).
  // A stable callback ref: an inline one runs on every render and would pull focus out of the inputs.
  const focusOnOpen = useCallback((el: HTMLDivElement | null) => {
    if (el && !el.contains(document.activeElement)) el.focus();
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className={['modal', `modal--${size.toLowerCase()}`, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={focusOnOpen}
        onKeyDown={(e) => { if (closesModal(e)) onClose(); }}
      >
        <div className="modal__header">
          {leading && <div className="modal__leading">{leading}</div>}
          <div className="modal__heading">
            {eyebrow && <span className="modal__eyebrow">{eyebrow}</span>}
            <div className="modal__title-row">
              <h2 id={titleId} className="modal__title">{title}</h2>
              {titleExtras}
            </div>
            {subtitle && <div className="modal__subtitle">{subtitle}</div>}
          </div>
          {aside && <div className="modal__aside">{aside}</div>}
          <IconButton icon={<CloseIcon />} label="Close" onClick={onClose} className="modal__close" />
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </ModalOverlay>
  );
};

export default Modal;
