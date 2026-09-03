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
import { loadInstruments, searchInstruments, getDisplayLabel, Instrument } from '@/services/instruments';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import AppSelect from '@/components/AppSelect/AppSelect';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import {
  PriceAlert,
  PriceAlertCondition,
  createPriceAlert,
  describePriceAlert,
  isPriceAlertTriggered,
  loadPriceAlerts,
  savePriceAlerts,
} from '@/services/priceAlerts';
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
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => loadPriceAlerts());
  const [alertDraftItem, setAlertDraftItem] = useState<WatchlistItem | null>(null);
  const [alertCondition, setAlertCondition] = useState<PriceAlertCondition>('above');
  const [alertValue, setAlertValue] = useState('');
  const [alertNote, setAlertNote] = useState('');
  const [alertBrowserNotification, setAlertBrowserNotification] = useState(false);
  const [alertToast, setAlertToast] = useState<string | null>(null);
  const alertToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Lookup map for display labels ──
  const instrumentMap = useMemo(() => {
    const map = new Map<number, Instrument>();
    for (const inst of instruments) map.set(inst.instrumentToken, inst);
    return map;
  }, [instruments]);

  useEffect(() => {
    savePriceAlerts(alerts);
  }, [alerts]);

  useEffect(() => () => {
    if (alertToastTimerRef.current) clearTimeout(alertToastTimerRef.current);
  }, []);

  const showAlertToast = useCallback((message: string) => {
    setAlertToast(message);
    if (alertToastTimerRef.current) clearTimeout(alertToastTimerRef.current);
    alertToastTimerRef.current = setTimeout(() => setAlertToast(null), 5000);
  }, []);

  const notifyAlertTriggered = useCallback((alert: PriceAlert, currentPrice: number) => {
    const message = `${describePriceAlert(alert)} hit. Current: ${formatPrice(currentPrice)}`;
    showAlertToast(message);

    if (alert.browserNotification && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('OptionTrap Price Alert', { body: message });
    }
  }, [showAlertToast]);

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

    setAlerts((prev) => {
      let changed = false;
      const priceByToken = new Map(ticks.map((t) => [t.instrumentToken, t.lastPrice]));
      const next = prev.map((alert) => {
        const currentPrice = priceByToken.get(alert.instrumentToken);
        if (currentPrice === undefined || !isPriceAlertTriggered(alert, currentPrice)) return alert;

        changed = true;
        notifyAlertTriggered(alert, currentPrice);
        return {
          ...alert,
          status: 'triggered' as const,
          triggeredAt: new Date().toISOString(),
          triggeredPrice: currentPrice,
        };
      });
      return changed ? next : prev;
    });
  }, [notifyAlertTriggered]);

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

  const openAlertModal = (item: WatchlistItem) => {
    const currentPrice = livePrices.get(item.instrumentToken)?.ltp;
    setAlertDraftItem(item);
    setAlertCondition('above');
    setAlertValue(currentPrice ? currentPrice.toFixed(2) : '');
    setAlertNote('');
    setAlertBrowserNotification(false);
  };

  const closeAlertModal = () => {
    setAlertDraftItem(null);
    setAlertValue('');
    setAlertNote('');
    setAlertBrowserNotification(false);
  };

  const handleCreateAlert = async () => {
    if (!alertDraftItem) return;
    const value = Number(alertValue);
    if (!Number.isFinite(value) || value <= 0) return;

    let browserNotification = alertBrowserNotification;
    if (browserNotification && 'Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      browserNotification = permission === 'granted';
    }

    const alert = createPriceAlert({
      instrumentToken: alertDraftItem.instrumentToken,
      tradingsymbol: alertDraftItem.tradingsymbol,
      exchange: alertDraftItem.exchange,
      condition: alertCondition,
      value,
      note: alertNote.trim() || undefined,
      browserNotification,
    });

    setAlerts((prev) => [alert, ...prev]);
    closeAlertModal();
  };

  const adjustAlertValue = (delta: number) => {
    const current = Number(alertValue) || 0;
    const next = Math.max(0, current + delta);
    setAlertValue(next.toFixed(2));
  };

  const handleDeleteAlert = (id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  };

  const handleResetAlert = (id: string) => {
    setAlerts((prev) => prev.map((alert) => alert.id === id
      ? { ...alert, status: 'active', triggeredAt: undefined, triggeredPrice: undefined }
      : alert));
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

  const formatDateTime = (value?: string) => value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-';

  const activeAlerts = alerts.filter((alert) => alert.status === 'active');
  const triggeredAlerts = alerts.filter((alert) => alert.status === 'triggered');
  const groupedAlerts = alerts.reduce<Array<{ key: string; symbol: string; exchange: string; alerts: PriceAlert[] }>>((groups, alert) => {
    const key = `${alert.instrumentToken}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.alerts.push(alert);
    else groups.push({ key, symbol: alert.tradingsymbol, exchange: alert.exchange, alerts: [alert] });
    return groups;
  }, []);

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
      {alertToast && (
        <div className="wl-alert-toast" role="status">
          <span className="wl-alert-toast__icon">!</span>
          <span>{alertToast}</span>
        </div>
      )}

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
                    <span className="wl-search__result-symbol">{getDisplayLabel(inst)}</span>
                    <span className="wl-search__result-name">{inst.instrumentType === 'EQ' ? inst.name : inst.tradingsymbol}</span>
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
                    <th className="wl-table__th wl-table__th--action">Actions</th>
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
                          <span className="wl-symbol">{instrumentMap.has(item.instrumentToken) ? getDisplayLabel(instrumentMap.get(item.instrumentToken)!) : item.tradingsymbol}</span>
                          <TradingViewLink symbol={item.tradingsymbol} exchange={item.exchange} />
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
                            className="wl-alert-btn"
                            onClick={() => openAlertModal(item)}
                            title="Create price alert"
                            aria-label={`Create price alert for ${item.tradingsymbol}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                              <path d="M12 4V2" />
                            </svg>
                          </button>
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

          <div className="wl-alerts">
            <div className="wl-alerts__header">
              <div>
                <h3 className="wl-alerts__title">Price Alerts</h3>
                <p className="wl-alerts__desc">Triggered alerts stay here until you reset or delete them.</p>
              </div>
              <span className="wl-alerts__count">{activeAlerts.length} active / {triggeredAlerts.length} triggered</span>
            </div>

            {alerts.length === 0 ? (
              <div className="wl-alerts__empty">No price alerts yet. Use the Alert button on a watchlist item.</div>
            ) : (
              <div className="wl-alerts__table-wrap">
                <table className="wl-alerts-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="wl-alerts-table__center">Condition</th>
                      <th className="wl-alerts-table__num">Tgt</th>
                      <th className="wl-alerts-table__num">LTP</th>
                      <th className="wl-alerts-table__center">Status</th>
                      <th className="wl-alerts-table__center">Time</th>
                      <th className="wl-alerts-table__center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedAlerts.map((group) => {
                      const groupActiveCount = group.alerts.filter((alert) => alert.status === 'active').length;
                      const groupTriggeredCount = group.alerts.length - groupActiveCount;

                      return (
                        <React.Fragment key={group.key}>
                          <tr className="wl-alert-group-row">
                            <td colSpan={7}>
                              <span className="wl-alerts-table__symbol">{group.symbol}</span>
                              <span className="wl-alerts-table__exchange">{group.exchange}</span>
                              <span className="wl-alert-group-row__count">
                                {groupActiveCount} active / {groupTriggeredCount} triggered
                              </span>
                            </td>
                          </tr>
                          {group.alerts.map((alert) => {
                            const price = livePrices.get(alert.instrumentToken);
                            return (
                              <tr key={alert.id}>
                                <td>
                                  {alert.note && <div className="wl-alerts-table__note">{alert.note}</div>}
                                </td>
                                <td className="wl-alerts-table__center">{alert.condition === 'above' ? 'Above' : 'Below'}</td>
                                <td className="wl-alerts-table__num">{formatPrice(alert.value)}</td>
                                <td className="wl-alerts-table__num">{price ? formatPrice(price.ltp) : alert.triggeredPrice ? formatPrice(alert.triggeredPrice) : '-'}</td>
                                <td className="wl-alerts-table__center">
                                  <span className={`wl-alert-status wl-alert-status--${alert.status}`}>
                                    {alert.status === 'active' ? 'Active' : 'Triggered'}
                                  </span>
                                </td>
                                <td className="wl-alerts-table__center">{formatDateTime(alert.triggeredAt)}</td>
                                <td className="wl-alerts-table__center">
                                  <div className="wl-alert-actions">
                                    {alert.status === 'triggered' && (
                                      <button className="wl-alert-action" onClick={() => handleResetAlert(alert.id)} title="Reset alert" aria-label={`Reset ${alert.tradingsymbol} alert`}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <path d="M3 12a9 9 0 1 0 3-6.7" />
                                          <path d="M3 4v6h6" />
                                        </svg>
                                      </button>
                                    )}
                                    <button className="wl-alert-action wl-alert-action--delete" onClick={() => handleDeleteAlert(alert.id)} title="Delete alert" aria-label={`Delete ${alert.tradingsymbol} alert`}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="wl-empty">
          <p className="wl-empty__text">
            No watchlists yet. Click the <strong>+</strong> button above to create one.
          </p>
        </div>
      )}

      {alertDraftItem && (
        <div className="wl-alert-modal-overlay" onMouseDown={closeAlertModal}>
          <div className="wl-alert-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="wl-alert-modal__header">
              <div>
                <h3>Create Price Alert</h3>
                <p>{alertDraftItem.tradingsymbol}</p>
              </div>
              <button className="wl-alert-modal__close" onClick={closeAlertModal}>x</button>
            </div>

            <div className="wl-alert-modal__body">
              <label className="wl-alert-field">
                <span>Condition</span>
                <AppSelect
                  value={alertCondition}
                  options={[
                    { value: 'above', label: 'Above' },
                    { value: 'below', label: 'Below' },
                  ]}
                  onChange={(value) => setAlertCondition(value as PriceAlertCondition)}
                  className="wl-alert-select"
                />
              </label>

              <label className="wl-alert-field">
                <span>Price</span>
                <div className="wl-alert-number">
                  <input
                    type="number"
                    value={alertValue}
                    onChange={(e) => setAlertValue(e.target.value)}
                    min={0}
                    step={0.05}
                    autoFocus
                  />
                  <div className="wl-alert-number__btns">
                    <button type="button" className="wl-alert-number__btn" onClick={() => adjustAlertValue(0.05)}>▲</button>
                    <button type="button" className="wl-alert-number__btn" onClick={() => adjustAlertValue(-0.05)}>▼</button>
                  </div>
                </div>
              </label>

              <label className="wl-alert-field">
                <span>Note</span>
                <textarea
                  value={alertNote}
                  onChange={(e) => setAlertNote(e.target.value)}
                  rows={3}
                  maxLength={160}
                  placeholder="Optional reason or action plan"
                />
              </label>

              <label className="wl-alert-check">
                <input
                  type="checkbox"
                  checked={alertBrowserNotification}
                  onChange={(e) => setAlertBrowserNotification(e.target.checked)}
                />
                <span className="wl-alert-check__box" aria-hidden="true" />
                <span>Browser notification</span>
              </label>
            </div>

            <div className="wl-alert-modal__footer">
              <button className="wl-alert-modal__secondary" onClick={closeAlertModal}>Cancel</button>
              <button className="wl-alert-modal__primary" onClick={handleCreateAlert} disabled={!Number(alertValue) || Number(alertValue) <= 0}>Create Alert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Watchlist;
