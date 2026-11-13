/**
 * One line that never scrolls: tabs that don't fit go under "+N". The active tab
 * always stays visible; when even it and "+N" don't fit, its name is cut further.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTabsThatFit } from '@/hooks/useTabsThatFit';
import './TabBar.css';

export interface TabBarItem<T extends string> {
  id: T;
  /** Wrap the name in <span className="tab-bar__text"> for "…" when it is long (done for you for a plain string). */
  label: React.ReactNode;
  /** Full name, shown on hover; defaults to the label when it is a string. */
  title?: string;
}

const tabText = (label: React.ReactNode) => (typeof label === 'string' ? <span className="tab-bar__text">{label}</span> : label);
const tabTitle = <T extends string>(item: TabBarItem<T>) => item.title ?? (typeof item.label === 'string' ? item.label : undefined);

interface TabBarProps<T extends string> {
  items: TabBarItem<T>[];
  activeId: T | null;
  onChange: (id: T) => void;
  /** Class of the bar (e.g. "analytics-tabs"). */
  className: string;
  /** Class of each tab (e.g. "analytics-tab"); the active one also gets `${tabClassName}--active`. */
  tabClassName: string;
  /** Custom markup for a visible tab (instead of a plain button); give its root the class "tab-bar__tab". */
  renderTab?: (item: TabBarItem<T>, active: boolean) => React.ReactNode;
  /** Markup with the same size as `renderTab`, for measuring. Defaults to the plain tab. */
  renderMeasure?: (item: TabBarItem<T>, active: boolean) => React.ReactNode;
  /** Controls after the tabs that always show (e.g. a "+" new-list button). */
  trailing?: React.ReactNode;
  ariaLabel?: string;
  /**
   * Let the active tab go under "+N" too when not even a short form of it fits,
   * e.g. while a wide trailing control (a new-list box) is open. Otherwise it always shows.
   */
  foldActiveWhenTight?: boolean;
}

function TabBar<T extends string>({
  items, activeId, onChange, className, tabClassName, renderTab, renderMeasure, trailing, ariaLabel, foldActiveWhenTight = false,
}: TabBarProps<T>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const visible = useTabsThatFit(rowRef, measureRef, trailingRef, items.findIndex((item) => item.id === activeId), Infinity, foldActiveWhenTight);
  const shown = visible ? items.filter((_, i) => visible.has(i)) : items;
  const more = visible ? items.filter((_, i) => !visible.has(i)) : [];

  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (event: MouseEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [moreOpen]);

  const tabClass = (active: boolean) => `${tabClassName} tab-bar__tab${active ? ` ${tabClassName}--active` : ''}`;
  const plainTab = (item: TabBarItem<T>, active: boolean) => (
    <button key={item.id} type="button" role="tab" aria-selected={active} className={tabClass(active)} title={tabTitle(item)} onClick={() => onChange(item.id)}>
      {tabText(item.label)}
    </button>
  );
  const measureTab = renderMeasure ?? ((item: TabBarItem<T>, active: boolean) => <span key={item.id} className={tabClass(active)}>{tabText(item.label)}</span>);

  return (
    <div className="tab-bar-row" ref={rowRef}>
      <div className="tab-bar__measure-box" aria-hidden="true">
        <div className={`${className} tab-bar--measure`} ref={measureRef}>
          {items.map((item) => measureTab(item, item.id === activeId))}
          <span className={`${tabClassName} tab-bar__more`}>+{items.length} ▾</span>
        </div>
      </div>

      <div className={`${className} tab-bar`} role="tablist" aria-label={ariaLabel}>
        {shown.map((item) => (renderTab ?? plainTab)(item, item.id === activeId))}

        {more.length > 0 && (
          <div className="tab-bar__more-wrap" ref={moreRef}>
            <button
              type="button"
              className={`${tabClassName} tab-bar__more${moreOpen ? ' tab-bar__more--open' : ''}`}
              onClick={() => setMoreOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              +{more.length} ▾
            </button>
            {moreOpen && (
              <div className="tab-bar__menu" role="menu">
                {more.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="tab-bar__menu-item"
                    title={tabTitle(item)}
                    onClick={() => { onChange(item.id); setMoreOpen(false); }}
                  >
                    {tabText(item.label)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {trailing && <div className="tab-bar__trailing" ref={trailingRef}>{trailing}</div>}
      </div>
    </div>
  );
}

export default TabBar;
