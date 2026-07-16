/**
 * AppSelect — custom styled combobox/select component.
 * Replaces native <select> with a fully theme-aware dropdown.
 * Supports optional search/filter when `searchable` prop is set.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
  searchable?: boolean;
  disabled?: boolean;
}

const AppSelect: React.FC<AppSelectProps> = ({
  value,
  options,
  onChange,
  className = '',
  placeholder = 'Select...',
  searchable = false,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.trim().toUpperCase();
    return options.filter((o) =>
      o.label.toUpperCase().includes(q) || String(o.value).toUpperCase().includes(q)
    );
  }, [options, search, searchable]);

  const positionDropdown = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(filteredOptions.length * 34 + (searchable ? 44 : 0) + 8, 320);
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
  }, [filteredOptions.length, searchable]);

  const handleOpen = () => {
    if (disabled) return;
    setSearch('');
    positionDropdown();
    setOpen(true);
    if (searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
    // Scroll selected option into view when dropdown opens
    setTimeout(() => selectedRef.current?.scrollIntoView({ block: 'nearest' }), 0);
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
    setSearch('');
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Enter') {
      if (!open) { handleOpen(); return; }
      // Select the currently highlighted option (the one matching `value`)
      const current = filteredOptions.find((o) => o.value === value);
      if (current) {
        handleSelect(current.value);
      } else if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0].value);
      }
      return;
    }
    if (e.key === ' ' && !searchable) { open ? setOpen(false) : handleOpen(); return; }
    if (!open) return;
    const currentIdx = filteredOptions.findIndex((o) => o.value === value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = filteredOptions[Math.min(currentIdx + 1, filteredOptions.length - 1)];
      if (next) {
        onChange(next.value);
        setTimeout(() => selectedRef.current?.scrollIntoView({ block: 'nearest' }), 0);
      }
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = filteredOptions[Math.max(currentIdx - 1, 0)];
      if (prev) {
        onChange(prev.value);
        setTimeout(() => selectedRef.current?.scrollIntoView({ block: 'nearest' }), 0);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`app-select-trigger ${open ? 'app-select-trigger--open' : ''} ${disabled ? 'app-select-trigger--disabled' : ''} ${className}`}
        onClick={() => { if (disabled) return; open ? setOpen(false) : handleOpen(); }}
        onKeyDown={!searchable ? handleKeyDown : undefined}
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
          {searchable && (
            <div className="app-select-search">
              <input
                ref={searchInputRef}
                type="text"
                className="app-select-search__input"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
              />
            </div>
          )}
          <div className="app-select-dropdown__inner">
            {filteredOptions.length === 0 && (
              <div className="app-select-option app-select-option--empty">No matches</div>
            )}
            {filteredOptions.map((opt) => (
              <div
                key={opt.value}
                ref={opt.value === value ? selectedRef : null}
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
