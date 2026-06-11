import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  fetchWatchlists,
  fetchWatchlistItems,
  createWatchlist,
  renameWatchlist as renameWatchlistApi,
  deleteWatchlist as deleteWatchlistApi,
  addWatchlistItem,
  removeWatchlistItem,
  WatchlistMeta,
  WatchlistItem,
} from '@/services/watchlist';
import { loadInstruments, searchInstruments, Instrument } from '@/services/instruments';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import '@/styles/watchlist.css';

// ── Price data stored per instrument token ──
interface LivePrice {
  ltp: number;
  close: number;
  high: number;
  low: number;
}

const Watchlist: React.FC = () => {
  // Tab metadata (no items)
  const [tabs, setTabs] = useState<WatchlistMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Active tab's items (loaded on demand)
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const loadedTabRef = useRef<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Instrument[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // New list prompt
  const [showNewInput, setShowNewInput] = useState(false);
  const [newListName, setNewListName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // Live prices
  const [livePrices, setLivePrices] = useState<Map<number, LivePrice>>(new Map());

  // Active tab metadata
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  // ── Load tab metadata on mount ──
  useEffect(() => {
    fetchWatchlists()
      .then((data) => {
        setTabs(data);
        if (data.length > 0) setActiveTabId(data[0].id);
      })
      .catch((err) => console.error('[Watchlist] Load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  // ── Load items when active tab changes ──
  useEffect(() => {
    if (!activeTabId || loadedTabRef.current === activeTabId) return;

    setItemsLoading(true);
    loadedTabRef.current = activeTabId;

    fetchWatchlistItems(activeTabId)
      .then((data) => setItems(data.items))
      .catch((err) => {
        console.error('[Watchlist] Load items failed:', err);
        setItems([]);
      })
      .finally(() => setItemsLoading(false));
  }, [activeTabId]);

  // ── Load instruments for search ──
  useEffect(() => {
    loadInstruments()
      .then(setInstruments)
      .catch((err) => console.error('[Watchlist] Instruments load failed:', err));
  }, []);

  // ── Ticker subscription ──
  const handleTicks = useCallback((ticks: Tick[]) => {
    setLivePrices((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const t of ticks) {
        const existing = next.get(t.instrumentToken);
        if (!existing || existing.ltp !== t.lastPrice) {
          next.set(t.instrumentToken, {
            ltp: t.lastPrice,
            close: t.closePrice ?? existing?.close ?? 0,
            high: t.highPrice ?? existing?.high ?? 0,
            low: t.lowPrice ?? existing?.low ?? 0,
          });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Subscribe to ticks for the active tab's items only
  const activeTokens = useMemo(
    () => items.map((item) => item.instrumentToken),
    [items],
  );

  useEffect(() => {
    if (activeTokens.length === 0) return;
    const unsub = tickerSubscribe('watchlist', activeTokens, handleTicks);
    return unsub;
  }, [activeTokens, handleTicks]);

  // ── Search logic ──
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const results = searchInstruments(instruments, searchQuery);

    // Filter out instruments already in the active tab
    const existingTokens = new Set(items.map((i) => i.instrumentToken));
    const filtered = results.filter((r) => !existingTokens.has(r.instrumentToken));

    setSearchResults(filtered);
    setShowDropdown(filtered.length > 0);
    setHighlightIdx(-1);
  }, [searchQuery, instruments, items]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Focus new list input
  useEffect(() => {
    if (showNewInput && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [showNewInput]);

  // ── Handlers ──

  const handleTabSwitch = (id: string) => {
    if (id === activeTabId) return;
    setActiveTabId(id);
    loadedTabRef.current = null; // force reload
    setLivePrices(new Map()); // clear stale prices from previous tab
    setSearchQuery('');
    setShowDropdown(false);
  };

  const handleCreateList = async () => {
    const name = newListName.trim();
    if (!name) return;

    try {
      const meta = await createWatchlist(name);
      setTabs((prev) => [...prev, meta]);
      handleTabSwitch(meta.id);
      setNewListName('');
      setShowNewInput(false);
    } catch (err) {
      console.error('[Watchlist] Create failed:', err);
    }
  };

  const handleRenameSubmit = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }

    try {
      await renameWatchlistApi(renamingId, renameValue.trim());
      setTabs((prev) =>
        prev.map((t) => (t.id === renamingId ? { ...t, name: renameValue.trim() } : t)),
      );
    } catch (err) {
      console.error('[Watchlist] Rename failed:', err);
    }
    setRenamingId(null);
  };

  const handleDeleteList = async (id: string) => {
    try {
      await deleteWatchlistApi(id);
      setTabs((prev) => {
        const updated = prev.filter((t) => t.id !== id);
        if (activeTabId === id) {
          const nextId = updated.length > 0 ? updated[0].id : null;
          setActiveTabId(nextId);
          loadedTabRef.current = null;
          if (!nextId) setItems([]);
        }
        return updated;
      });
    } catch (err) {
      console.error('[Watchlist] Delete failed:', err);
    }
  };

  const handleAddItem = async (instrument: Instrument) => {
    if (!activeTabId) return;

    try {
      const item = await addWatchlistItem(activeTabId, {
        instrumentToken: instrument.instrumentToken,
        tradingsymbol: instrument.tradingsymbol,
        exchange: instrument.exchange,
      });

      setItems((prev) => [...prev, item]);
      // Update tab's item count
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, itemCount: t.itemCount + 1 } : t,
        ),
      );
      setSearchQuery('');
      setShowDropdown(false);
    } catch (err) {
      console.error('[Watchlist] Add item failed:', err);
    }
  };

  const handleRemoveItem = async (item: WatchlistItem) => {
    if (!activeTabId) return;

    try {
      await removeWatchlistItem(activeTabId, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      // Update tab's item count
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, itemCount: Math.max(0, t.itemCount - 1) } : t,
        ),
      );
    } catch (err) {
      console.error('[Watchlist] Remove item failed:', err);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      handleAddItem(searchResults[highlightIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // ── Helpers ──

  const formatPrice = (n: number) =>
    n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const getChange = (price: LivePrice) => {
    if (!price.close) return { abs: 0, pct: 0 };
    const abs = price.ltp - price.close;
    const pct = (abs / price.close) * 100;
    return { abs, pct };
  };

  // ── Render ──

  if (loading) {
    return (
      <div className="wl-loading">
        <div className="wl-loading__spinner" />
      </div>
    );
  }

  return (
    <div className="wl">
      {/* ── Tab bar ── */}
      <div className="wl-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`wl-tab ${activeTabId === tab.id ? 'wl-tab--active' : ''}`}
          >
            {renamingId === tab.id ? (
              <input
                ref={renameInputRef}
                className="wl-tab__rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button
                className="wl-tab__label"
                onClick={() => handleTabSwitch(tab.id)}
                onDoubleClick={() => {
                  setRenamingId(tab.id);
                  setRenameValue(tab.name);
                }}
              >
                {tab.name}
                <span className="wl-tab__count">{tab.itemCount}</span>
              </button>
            )}
            <button
              className="wl-tab__delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteList(tab.id);
              }}
              title="Delete watchlist"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ))}

        {showNewInput ? (
          <div className="wl-tab wl-tab--new">
            <input
              ref={newInputRef}
              className="wl-tab__rename-input"
              placeholder="List name"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onBlur={() => {
                if (newListName.trim()) handleCreateList();
                else setShowNewInput(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateList();
                if (e.key === 'Escape') setShowNewInput(false);
              }}
            />
          </div>
        ) : (
          <button
            className="wl-tab wl-tab--add"
            onClick={() => setShowNewInput(true)}
            title="Create new watchlist"
          >
            +
          </button>
        )}
      </div>

      {/* ── Content ── */}
      {activeTab ? (
        <div className="wl-content">
          {/* Search bar */}
          <div className="wl-search" ref={searchRef}>
            <input
              ref={inputRef}
              className="wl-search__input"
              placeholder="Search & add instrument (e.g. RELIANCE, TCS)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
            />
            <span className="wl-search__count">
              {activeTab.itemCount}/100
            </span>

            {showDropdown && (
              <div className="wl-search__dropdown">
                {searchResults.map((inst, idx) => (
                  <button
                    key={inst.instrumentToken}
                    className={`wl-search__result ${idx === highlightIdx ? 'wl-search__result--active' : ''}`}
                    onClick={() => handleAddItem(inst)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                  >
                    <span className="wl-search__result-symbol">{inst.tradingsymbol}</span>
                    <span className="wl-search__result-name">{inst.name}</span>
                    <span className="wl-search__result-exchange">{inst.exchange}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items loading indicator */}
          {itemsLoading ? (
            <div className="wl-loading">
              <div className="wl-loading__spinner" />
            </div>
          ) : items.length > 0 ? (
            <div className="wl-table-wrap">
              <table className="wl-table">
                <thead>
                  <tr>
                    <th className="wl-table__th wl-table__th--symbol">Symbol</th>
                    <th className="wl-table__th wl-table__th--num">LTP</th>
                    <th className="wl-table__th wl-table__th--num">Change</th>
                    <th className="wl-table__th wl-table__th--num">Change %</th>
                    <th className="wl-table__th wl-table__th--num">High</th>
                    <th className="wl-table__th wl-table__th--num">Low</th>
                    <th className="wl-table__th wl-table__th--action" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const price = livePrices.get(item.instrumentToken);
                    const change = price ? getChange(price) : null;
                    const changeColor = change
                      ? change.abs > 0
                        ? 'wl-cell--up'
                        : change.abs < 0
                          ? 'wl-cell--down'
                          : ''
                      : '';

                    return (
                      <tr key={item.id} className="wl-table__row">
                        <td className="wl-table__td wl-table__td--symbol">
                          <span className="wl-symbol">{item.tradingsymbol}</span>
                          <span className="wl-exchange">{item.exchange}</span>
                        </td>
                        <td className={`wl-table__td wl-table__td--num ${changeColor}`}>
                          {price ? formatPrice(price.ltp) : '—'}
                        </td>
                        <td className={`wl-table__td wl-table__td--num ${changeColor}`}>
                          {change ? `${change.abs >= 0 ? '+' : ''}${formatPrice(change.abs)}` : '—'}
                        </td>
                        <td className={`wl-table__td wl-table__td--num ${changeColor}`}>
                          {change
                            ? `${change.pct >= 0 ? '+' : ''}${change.pct.toFixed(2)}%`
                            : '—'}
                        </td>
                        <td className="wl-table__td wl-table__td--num">
                          {price && price.high ? formatPrice(price.high) : '—'}
                        </td>
                        <td className="wl-table__td wl-table__td--num">
                          {price && price.low ? formatPrice(price.low) : '—'}
                        </td>
                        <td className="wl-table__td wl-table__td--action">
                          <button
                            className="wl-remove-btn"
                            onClick={() => handleRemoveItem(item)}
                            title="Remove from watchlist"
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="wl-empty">
              <p className="wl-empty__text">
                No instruments in this list. Use the search bar above to add stocks.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="wl-empty">
          <p className="wl-empty__text">
            No watchlists yet. Click the <strong>+</strong> button above to create one.
          </p>
        </div>
      )}
    </div>
  );
};

export default Watchlist;
