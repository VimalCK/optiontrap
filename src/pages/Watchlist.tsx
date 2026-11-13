import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { reorderWatchlistItems, type WatchlistItem } from '@/services/watchlist';
import { loadInstruments, type Instrument } from '@/services/instruments';
import type { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { fetchStockScans, type ScanSummary } from '@/services/stockSetups';
import { isAbortError } from '@/services/apiClient';
import { isCashStock } from '../../shared/stockSetups.js';
import StockSetupsPanel from '@/components/StockSetups/StockSetupsPanel';
import SetupScorecard from '@/components/StockSetups/SetupScorecard';
import WatchlistTabs from '@/components/Watchlist/WatchlistTabs';
import InstrumentSearch from '@/components/Watchlist/InstrumentSearch';
import WatchlistTable from '@/components/Watchlist/WatchlistTable';
import PriceAlertsTable from '@/components/Watchlist/PriceAlertsTable';
import PriceAlertModal, { type AlertPrefill } from '@/components/Watchlist/PriceAlertModal';
import { useWatchlists } from '@/components/Watchlist/useWatchlists';
import { failureMessage, usePriceAlerts, useTimedToast } from '@/components/Watchlist/usePriceAlerts';
import { useDragReorder } from '@/components/Watchlist/useDragReorder';
import { withPriceTicks, type LivePrice } from '@/components/Watchlist/watchlistRows';
import '@/styles/watchlist.css';

const Spinner: React.FC = () => (
  <div className="wl-loading">
    <div className="wl-loading__spinner" />
  </div>
);

const Watchlist: React.FC = () => {
  const lists = useWatchlists();
  const { activeTab, activeTabId, items, setItems } = lists;
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [livePrices, setLivePrices] = useState<Map<number, LivePrice>>(new Map());
  const { toast, showToast } = useTimedToast();
  const priceAlerts = usePriceAlerts(showToast);
  const { checkTicks } = priceAlerts;
  const [alertDraft, setAlertDraft] = useState<{ item: WatchlistItem; prefill?: AlertPrefill } | null>(null);
  const [setupsItem, setSetupsItem] = useState<WatchlistItem | null>(null);
  // The stock row selected to show its setup scorecard; clicking it again hides the card.
  const [scorecardToken, setScorecardToken] = useState<number | null>(null);
  const [scans, setScans] = useState<Map<number, ScanSummary>>(new Map());
  const [scansVersion, setScansVersion] = useState(0);

  const drag = useDragReorder({
    items,
    setItems,
    save: async (ordered) => {
      if (activeTabId) await reorderWatchlistItems(activeTabId, ordered.map((i) => i.id));
    },
    onSaveFailed: (err) => showToast(failureMessage('save the new order', err)),
  });

  useEffect(() => {
    loadInstruments()
      .then(setInstruments)
      .catch((err) => console.error('[Watchlist] Instruments load failed:', err));
  }, []);

  const instrumentMap = useMemo(() => new Map(instruments.map((inst) => [inst.instrumentToken, inst])), [instruments]);

  // Reload scans on mount and after a panel closes: opening one re-scans that stock.
  useEffect(() => {
    const controller = new AbortController();
    fetchStockScans(controller.signal)
      .then(setScans)
      .catch((err) => { if (!isAbortError(err)) console.error('[Watchlist] Scans load failed:', err); });
    return () => controller.abort();
  }, [scansVersion]);

  const isStockItem = useCallback(
    (item: WatchlistItem) => isCashStock({ ...item, instrumentType: instrumentMap.get(item.instrumentToken)?.instrumentType }),
    [instrumentMap],
  );

  // Only shown while the selected stock is in the open tab.
  const scorecardItem = useMemo(
    () => items.find((item) => item.instrumentToken === scorecardToken && isStockItem(item)) ?? null,
    [items, scorecardToken, isStockItem],
  );

  const closeSetupsPanel = useCallback(() => {
    setSetupsItem(null);
    setScansVersion((v) => v + 1);
  }, []);

  const handleTicks = useCallback((ticks: Tick[]) => {
    setLivePrices((prev) => withPriceTicks(prev, ticks));
    checkTicks(ticks);
  }, [checkTicks]);

  const activeTokens = useMemo(() => items.map((item) => item.instrumentToken), [items]);

  useEffect(() => {
    if (activeTokens.length === 0) return;
    return tickerSubscribe('watchlist', activeTokens, handleTicks);
  }, [activeTokens, handleTicks]);

  const openTab = (id: string) => {
    if (id === activeTabId) return;
    lists.openTab(id);
    setLivePrices(new Map());
  };

  const createList = async (name: string) => {
    const meta = await lists.createList(name);
    if (meta) openTab(meta.id);
    return meta !== null;
  };

  if (lists.loading) return <Spinner />;

  return (
    <div className="wl">
      {toast && (
        <div className="wl-alert-toast" role="status">
          <span className="wl-alert-toast__icon">!</span>
          <span>{toast}</span>
        </div>
      )}

      <WatchlistTabs tabs={lists.tabs} activeId={activeTabId} onOpen={openTab} onCreate={createList} onRename={lists.renameList} onDelete={lists.deleteList} />

      {activeTab ? (
        <div className="wl-content">
          {/* Keyed by the list, so opening another one clears the search. */}
          <InstrumentSearch key={activeTab.id} instruments={instruments} items={items} itemCount={activeTab.itemCount} onAdd={lists.addItem} />

          {lists.itemsLoading ? <Spinner /> : items.length > 0 ? (
            <WatchlistTable
              items={items}
              instrumentMap={instrumentMap}
              livePrices={livePrices}
              scans={scans}
              isStockItem={isStockItem}
              selectedToken={scorecardToken}
              onSelect={(item) => setScorecardToken((prev) => (prev === item.instrumentToken ? null : item.instrumentToken))}
              drag={drag}
              onOpenSetups={setSetupsItem}
              onAlert={(item) => setAlertDraft({ item })}
              onRemove={lists.removeItem}
            />
          ) : (
            <div className="wl-empty">
              <p className="wl-empty__text">No instruments in this list. Use the search bar above to add stocks.</p>
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

      {scorecardItem && (
        <SetupScorecard key={scorecardItem.instrumentToken} instrumentToken={scorecardItem.instrumentToken} tradingsymbol={scorecardItem.tradingsymbol} refreshKey={scansVersion} />
      )}

      <PriceAlertsTable alerts={priceAlerts.alerts} livePrices={livePrices} onReset={priceAlerts.resetAlert} onDelete={priceAlerts.deleteAlert} />

      {setupsItem && (
        <StockSetupsPanel
          instrumentToken={setupsItem.instrumentToken}
          tradingsymbol={setupsItem.tradingsymbol}
          livePrice={livePrices.get(setupsItem.instrumentToken)?.ltp}
          onClose={closeSetupsPanel}
          onSetAlert={(condition, value, note) => {
            const item = setupsItem;
            closeSetupsPanel();
            setAlertDraft({ item, prefill: { condition, value, note } });
          }}
        />
      )}

      {alertDraft && (
        <PriceAlertModal
          key={alertDraft.item.id}
          item={alertDraft.item}
          currentPrice={livePrices.get(alertDraft.item.instrumentToken)?.ltp}
          prefill={alertDraft.prefill}
          onClose={() => setAlertDraft(null)}
          onCreate={priceAlerts.createAlert}
        />
      )}
    </div>
  );
};

export default Watchlist;
