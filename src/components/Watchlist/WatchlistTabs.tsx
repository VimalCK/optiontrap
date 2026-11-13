import React, { useEffect, useRef, useState } from 'react';
import TabBar from '@/components/TabBar/TabBar';
import { CloseIcon } from '@/components/icons/Icons';
import type { WatchlistMeta } from '@/services/watchlist';

const MIN_RENAME_WIDTH_PX = 96;

/**
 * One tab per watchlist with its item count (a delete button on hover); a double-click renames a tab in place,
 * and + opens a name box for a new list.
 */
const WatchlistTabs: React.FC<{
  tabs: WatchlistMeta[];
  activeId: string | null;
  onOpen: (id: string) => void;
  /** Resolves to whether it was created. */
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
}> = ({ tabs, activeId, onOpen, onCreate, onRename, onDelete }) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Width of the tab being renamed, so its name box starts the same size and nothing moves.
  const [renameWidth, setRenameWidth] = useState<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newListName, setNewListName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (showNewInput && newInputRef.current) newInputRef.current.focus();
  }, [showNewInput]);

  const submitRename = async () => {
    const name = renameValue.trim();
    if (renamingId && name) await onRename(renamingId, name);
    setRenamingId(null);
  };

  const submitNewList = async () => {
    const name = newListName.trim();
    if (!name || !(await onCreate(name))) return;
    setNewListName('');
    setShowNewInput(false);
  };

  const tabName = (id: string) => tabs.find((t) => t.id === id)?.name;
  const tabCount = (id: string) => tabs.find((t) => t.id === id)?.itemCount;

  return (
    <TabBar
      items={tabs.map((tab) => ({
        id: tab.id,
        label: <><span className="tab-bar__text">{tab.name}</span><span className="wl-tab__count">{tab.itemCount}</span></>,
        title: tab.name,
      }))}
      activeId={activeId}
      onChange={onOpen}
      className="wl-tabs"
      tabClassName="wl-tab"
      ariaLabel="Watchlists"
      foldActiveWhenTight={showNewInput}
      renderMeasure={(item, active) => (
        <div key={item.id} className={`wl-tab tab-bar__tab${active ? ' wl-tab--active' : ''}`}>
          <span className="wl-tab__label"><span className="tab-bar__text">{tabName(item.id)}</span></span>
          <span className="wl-tab__badge"><span className="wl-tab__count">{tabCount(item.id)}</span></span>
        </div>
      )}
      renderTab={(item, active) => {
        const name = tabName(item.id);
        if (renamingId === item.id) {
          // Editing: only the name box, sized like the tab it replaces. The tab holds the
          // width (and narrows on a tight row); the box fills it, so its border always shows.
          return (
            <div
              key={item.id}
              className="wl-tab tab-bar__tab wl-tab--editing"
              style={renameWidth ? { width: Math.max(renameWidth, MIN_RENAME_WIDTH_PX) } : undefined}
            >
              <input
                ref={renameInputRef}
                className="wl-tab__rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            </div>
          );
        }
        return (
          <div key={item.id} className={`wl-tab tab-bar__tab${active ? ' wl-tab--active' : ''}`}>
            <button
              type="button"
              className="wl-tab__label"
              title={item.title}
              onClick={() => onOpen(item.id)}
              onDoubleClick={(e) => {
                setRenameWidth((e.currentTarget.closest('.wl-tab') as HTMLElement | null)?.offsetWidth ?? null);
                setRenamingId(item.id);
                setRenameValue(name ?? '');
              }}
            >
              <span className="tab-bar__text">{name}</span>
            </button>
            {/* The item count; on hover it turns into the delete button, in the same space. */}
            <button
              type="button"
              className="wl-tab__badge"
              onClick={() => onDelete(item.id)}
              title={`Delete ${name ?? 'watchlist'}`}
              aria-label={`Delete watchlist ${name ?? ''}`}
            >
              <span className="wl-tab__count">{tabCount(item.id)}</span>
              <span className="wl-tab__badge-delete" aria-hidden="true">
                <CloseIcon size={10} strokeWidth={3} />
              </span>
            </button>
          </div>
        );
      }}
      trailing={showNewInput ? (
        <div className="wl-tab wl-tab--new">
          <input
            ref={newInputRef}
            className="wl-tab__rename-input wl-tab__rename-input--new"
            placeholder="List name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onBlur={() => {
              if (newListName.trim()) void submitNewList();
              else setShowNewInput(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewList();
              if (e.key === 'Escape') setShowNewInput(false);
            }}
          />
        </div>
      ) : (
        <button type="button" className="wl-tab wl-tab--add" onClick={() => setShowNewInput(true)} title="Create new watchlist">
          +
        </button>
      )}
    />
  );
};

export default WatchlistTabs;
