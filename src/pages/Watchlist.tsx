import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  fetchWatchlists,
  createWatchlist,
  renameWatchlist as renameWatchlistApi,
  deleteWatchlist as deleteWatchlistApi,
  addWatchlistItem,
  removeWatchlistItem,
  Watchlist as WatchlistType,
  WatchlistItem,
} from '@/services/watchlist';
import { loadInstruments, searchInstruments, Instrument } from '@/services/instruments';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe, tickerUpdateTokens } from '@/services/tickerSingleton';
import '@/styles/watchlist.css';

// ── Price data stored per instrument token ──
interface LivePrice {
  ltp: number;
  close: number;
  high: number;
  low: number;
}

const Watchlist: React.FC = () => {
  const [lists, setLists] = useState<WatchlistType[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  // ── Active list derived from state ──
  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) ?? null,
    [lists, activeListId],
  );

  // ── Load watchlists on mount ──
  useEffect(() => {
    fetchWatchlists()
      .then((data) => {
        setLists(data);
        if (data.length > 0) setActiveListId(data[0].id);
      })
      .catch((err) => console.error('[Watchlist] Load failed:', err))
      .finally(() => setLoading(false));
  }, []);

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

  // Subscribe to ticks for all items across all lists
  const allTokens = useMemo(() => {
    const tokens = new Set<number>();
    lists.forEach((l) => l.items.forEach((item) => tokens.add(item.instrumentToken)));
    return Array.from(tokens);
  }, [lists]);

  useEffect(() => {
    if (allTokens.length === 0) return;
    const unsub = tickerSubscribe('watchlist', allTokens, handleTicks);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (allTokens.length > 0) {
      tickerUpdateTokens('watchlist', allTokens);
    }
  }, [allTokens]);

  // ── Search logic ──
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const results = searchInstruments(instruments, searchQuery);

    // Filter out instruments already in the active list
    const existingTokens = new Set(activeList?.items.map((i) => i.instrumentToken) ?? []);
    const filtered = results.filter((r) => !existingTokens.has(r.instrumentToken));

    setSearchResults(filtered);
    setShowDropdown(filtered.length > 0);
    setHighlightIdx(-1);
  }, [searchQuery, instruments, activeList]);

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

  const handleCreateList = async () => {
    const name = newListName.trim();
    if (!name) return;

    try {
      const list = await createWatchlist(name);
      setLists((prev) => [...prev, list]);
      setActiveListId(list.id);
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
      setLists((prev) =>
        prev.map((l) => (l.id === renamingId ? { ...l, name: renameValue.trim() } : l)),
      );
    } catch (err) {
      console.error('[Watchlist] Rename failed:', err);
    }
    setRenamingId(null);
  };

  const handleDeleteList = async (id: string) => {
    try {
      await deleteWatchlistApi(id);
      setLists((prev) => {
        const updated = prev.filter((l) => l.id !== id);
        if (activeListId === id) {
          setActiveListId(updated.length > 0 ? updated[0].id : null);
        }
        return updated;
      });
    } catch (err) {
      console.error('[Watchlist] Delete failed:', err);
    }
  };

  const handleAddItem = async (instrument: Instrument) => {
    if (!activeListId) return;

    try {
      const item = await addWatchlistItem(activeListId, {
        instrumentToken: instrument.instrumentToken,
        tradingsymbol: instrument.tradingsymbol,
        exchange: instrument.exchange,
      });

      setLists((prev) =>
        prev.map((l) =>
          l.id === activeListId ? { ...l, items: [...l.items, item] } : l,
        ),
      );
      setSearchQuery('');
      setShowDropdown(false);
    } catch (err) {
      console.error('[Watchlist] Add item failed:', err);
    }
  };

  const handleRemoveItem = async (item: WatchlistItem) => {
    if (!activeListId) return;

    try {
      await removeWatchlistItem(activeListId, item.id);
      setLists((prev) =>
        prev.map((l) =>
          l.id === activeListId
            ? { ...l, items: l.items.filter((i) => i.id !== item.id) }
            : l,
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
        {lists.map((list) => (
          <div
            key={list.id}
            className={`wl-tab ${activeListId === list.id ? 'wl-tab--active' : ''}`}
          >
            {renamingId === list.id ? (
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
                onClick={() => setActiveListId(list.id)}
                onDoubleClick={() => {
                  setRenamingId(list.id);
                  setRenameValue(list.name);
                }}
              >
                {list.name}
                <span className="wl-tab__count">{list.items.length}</span>
              </button>
            )}
            <button
              className="wl-tab__delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteList(list.id);
              }}
              title="Delete watchlist"
            >
              &times;
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
      {activeList ? (
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
              {activeList.items.length}/100
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

          {/* Instrument table */}
          {activeList.items.length > 0 ? (
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
                  {activeList.items.map((item) => {
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
                        <td className="wl-table__td wl-table__td--num">
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
