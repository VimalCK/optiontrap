import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addWatchlistItem, createWatchlist, deleteWatchlist, fetchWatchlistItems, fetchWatchlists, removeWatchlistItem, renameWatchlist,
  type WatchlistItem, type WatchlistMeta,
} from '@/services/watchlist';
import type { Instrument } from '@/services/instruments';

const withItemCount = (tabs: WatchlistMeta[], id: string, change: number) =>
  tabs.map((t) => (t.id === id ? { ...t, itemCount: Math.max(0, t.itemCount + change) } : t));

/** The user's watchlists (metadata only) and the open one's items, loaded when it is opened. */
export function useWatchlists() {
  const [tabs, setTabs] = useState<WatchlistMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const loadedTabRef = useRef<string | null>(null);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);

  useEffect(() => {
    fetchWatchlists()
      .then((data) => {
        setTabs(data);
        if (data.length > 0) setActiveTabId(data[0].id);
      })
      .catch((err) => console.error('[Watchlist] Load failed:', err))
      .finally(() => setLoading(false));
  }, []);

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

  const openTab = (id: string) => {
    setActiveTabId(id);
    loadedTabRef.current = null;
  };

  /** Resolves to the new list, or null when it couldn't be created. */
  const createList = async (name: string): Promise<WatchlistMeta | null> => {
    try {
      const meta = await createWatchlist(name);
      setTabs((prev) => [...prev, meta]);
      return meta;
    } catch (err) {
      console.error('[Watchlist] Create failed:', err);
      return null;
    }
  };

  const renameList = async (id: string, name: string) => {
    try {
      await renameWatchlist(id, name);
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
    } catch (err) {
      console.error('[Watchlist] Rename failed:', err);
    }
  };

  /** Deleting the open list opens the first one left. */
  const deleteList = async (id: string) => {
    try {
      await deleteWatchlist(id);
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

  /** Resolves to whether it was added. */
  const addItem = async (instrument: Instrument): Promise<boolean> => {
    if (!activeTabId) return false;
    try {
      const item = await addWatchlistItem(activeTabId, {
        instrumentToken: instrument.instrumentToken,
        tradingsymbol: instrument.tradingsymbol,
        exchange: instrument.exchange,
      });
      setItems((prev) => [...prev, item]);
      setTabs((prev) => withItemCount(prev, activeTabId, 1));
      return true;
    } catch (err) {
      console.error('[Watchlist] Add item failed:', err);
      return false;
    }
  };

  const removeItem = async (item: WatchlistItem) => {
    if (!activeTabId) return;
    try {
      await removeWatchlistItem(activeTabId, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setTabs((prev) => withItemCount(prev, activeTabId, -1));
    } catch (err) {
      console.error('[Watchlist] Remove item failed:', err);
    }
  };

  return { tabs, activeTab, activeTabId, loading, items, setItems, itemsLoading, openTab, createList, renameList, deleteList, addItem, removeItem };
}
