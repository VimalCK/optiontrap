/**
 * Used instead of a native <select>. Pass `selectedValues` instead of `value` for a
 * multi-select: each option gets a checkbox, a click toggles it through `onChange`,
 * and the list stays open.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { CheckIcon, ChevronDownIcon } from '@/components/icons/Icons';
import { createPortal } from 'react-dom';
import './AppSelect.css';

export interface AppSelectOption {
  value: string | number;
  label: string;
}

interface AppSelectProps {
  value?: string | number;
  selectedValues?: (string | number)[];
  options: AppSelectOption[];
  onChange: (value: string | number) => void;
  className?: string;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
}

const AppSelect: React.FC<AppSelectProps> = ({
  value,
  selectedValues,
  options,
  onChange,
  className = '',
  placeholder = 'Select...',
  searchable = false,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const highlightedRef = useRef<HTMLDivElement>(null);

  const multi = selectedValues !== undefined;
  const isSelected = (optValue: string | number) => (multi ? selectedValues.includes(optValue) : optValue === value);
  const selectedLabel = multi
    ? options.filter((o) => isSelected(o.value)).map((o) => o.label).join(', ') || placeholder
    : options.find((o) => o.value === value)?.label ?? placeholder;

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.trim().toUpperCase();
    return options.filter((o) =>
      o.label.toUpperCase().includes(q) || String(o.value).toUpperCase().includes(q)
    );
  }, [options, search, searchable]);

  useEffect(() => {
    if (!open) return;
    setHighlightedIdx((prev) => {
      if (prev === null || prev >= filteredOptions.length) return 0;
      return prev;
    });
  }, [filteredOptions, open]);

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
    const currentIdx = options.findIndex((o) => o.value === value);
    setHighlightedIdx(currentIdx >= 0 ? currentIdx : 0);
    positionDropdown();
    setOpen(true);
    if (searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
    setTimeout(() => highlightedRef.current?.scrollIntoView({ block: 'nearest' }), 0);
  };

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
    if (multi) return; // keep the list open to tick more
    setOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Enter') {
      if (!open) { handleOpen(); return; }
      if (highlightedIdx !== null && filteredOptions[highlightedIdx]) {
        handleSelect(filteredOptions[highlightedIdx].value);
      }
      return;
    }
    if (e.key === ' ' && !searchable) { open ? setOpen(false) : handleOpen(); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => {
        const next = prev === null ? 0 : Math.min(prev + 1, filteredOptions.length - 1);
        setTimeout(() => highlightedRef.current?.scrollIntoView({ block: 'nearest' }), 0);
        return next;
      });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) => {
        const next = prev === null ? 0 : Math.max(prev - 1, 0);
        setTimeout(() => highlightedRef.current?.scrollIntoView({ block: 'nearest' }), 0);
        return next;
      });
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
        <ChevronDownIcon size={16} className={`app-select-trigger__chevron ${open ? 'app-select-trigger__chevron--open' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className={`app-select-dropdown ${multi ? 'app-select-dropdown--multi' : ''}`}
          style={dropdownStyle}
          role="listbox"
          aria-multiselectable={multi || undefined}
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
            {filteredOptions.map((opt, idx) => (
              <div
                key={opt.value}
                ref={idx === highlightedIdx ? highlightedRef : null}
                role="option"
                aria-selected={isSelected(opt.value)}
                className={`app-select-option ${!multi && opt.value === value ? 'app-select-option--selected' : ''} ${idx === highlightedIdx ? 'app-select-option--highlighted' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.value); }}
                onMouseEnter={() => setHighlightedIdx(idx)}
              >
                {multi && (
                  <span className={`app-select-option__checkbox ${isSelected(opt.value) ? 'app-select-option__checkbox--checked' : ''}`}>
                    {isSelected(opt.value) && (
                      <CheckIcon size={12} strokeWidth={3} />
                    )}
                  </span>
                )}
                {!multi && opt.value === value && (
                  <CheckIcon size={12} strokeWidth={3.6} className="app-select-option__check" />
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
