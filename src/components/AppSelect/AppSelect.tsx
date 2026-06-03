/**
 * AppSelect — custom styled combobox/select component.
 * Replaces native <select> with a fully theme-aware dropdown.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './AppSelect.css';

export interface AppSelectOption {
  value: string | number;
  label: string;
}

interface AppSelectProps {
  value: string | number;
  options: AppSelectOption[];
  onChange: (value: string | number) => void;
  className?: string;
  placeholder?: string;
}

const AppSelect: React.FC<AppSelectProps> = ({
  value,
  options,
  onChange,
  className = '',
  placeholder = 'Select...',
}) => {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  const positionDropdown = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(options.length * 34 + 8, 280);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < dropdownHeight + 8 && rect.top > dropdownHeight;

    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 180),
      zIndex: 9999,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, [options.length]);

  const handleOpen = () => {
    positionDropdown();
    setOpen(true);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on scroll/resize — but NOT when scrolling inside the dropdown itself
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      // Ignore scroll events that happen inside the dropdown
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const handleSelect = (optValue: string | number) => {
    onChange(optValue);
    setOpen(false);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { open ? setOpen(false) : handleOpen(); return; }
    if (!open) return;
    const currentIdx = options.findIndex((o) => o.value === value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = options[Math.min(currentIdx + 1, options.length - 1)];
      if (next) onChange(next.value);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = options[Math.max(currentIdx - 1, 0)];
      if (prev) onChange(prev.value);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`app-select-trigger ${open ? 'app-select-trigger--open' : ''} ${className}`}
        onClick={() => open ? setOpen(false) : handleOpen()}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="app-select-trigger__label">{selectedLabel}</span>
        <svg
          className={`app-select-trigger__chevron ${open ? 'app-select-trigger__chevron--open' : ''}`}
          width="10" height="6" viewBox="0 0 10 6" fill="none"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="app-select-dropdown"
          style={dropdownStyle}
          role="listbox"
        >
          <div className="app-select-dropdown__inner">
            {options.map((opt) => (
              <div
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={`app-select-option ${opt.value === value ? 'app-select-option--selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.value); }}
              >
                {opt.value === value && (
                  <svg className="app-select-option__check" width="12" height="10" viewBox="0 0 12 10" fill="none">
                    <path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span>{opt.label}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default AppSelect;
