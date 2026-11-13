import React from 'react';
import { BellIcon, DragHandleIcon, TrashIcon } from '@/components/icons/Icons';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import SetupChip from '@/components/StockSetups/SetupChip';
import { getDisplayLabel, type Instrument } from '@/services/instruments';
import type { ScanSummary } from '@/services/stockSetups';
import type { WatchlistItem } from '@/services/watchlist';
import { changeClass, formatPrice, priceChange, type LivePrice } from './watchlistRows';
import type { useDragReorder } from './useDragReorder';

type Drag = ReturnType<typeof useDragReorder<WatchlistItem>>;

const signed = (n: number, text: string) => `${n >= 0 ? '+' : ''}${text}`;

/**
 * The open list: live price, change and day range per instrument, the stock setups chip, and alert / remove
 * buttons. A stock row's click selects it for the scorecard; rows reorder by their drag handle.
 */
const WatchlistTable: React.FC<{
  items: WatchlistItem[];
  instrumentMap: Map<number, Instrument>;
  livePrices: Map<number, LivePrice>;
  scans: Map<number, ScanSummary>;
  isStockItem: (item: WatchlistItem) => boolean;
  selectedToken: number | null;
  onSelect: (item: WatchlistItem) => void;
  drag: Drag;
  onOpenSetups: (item: WatchlistItem) => void;
  onAlert: (item: WatchlistItem) => void;
  onRemove: (item: WatchlistItem) => void;
}> = ({ items, instrumentMap, livePrices, scans, isStockItem, selectedToken, onSelect, drag, onOpenSetups, onAlert, onRemove }) => (
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
          <th className="wl-table__th wl-table__th--setup" title="From the latest after-close scan of daily candles">Setups</th>
          <th className="wl-table__th wl-table__th--action">Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const price = livePrices.get(item.instrumentToken);
          const change = price ? priceChange(price) : null;
          const changeColor = changeClass(change);
          const isStock = isStockItem(item);
          const instrument = instrumentMap.get(item.instrumentToken);
          const selected = selectedToken === item.instrumentToken;
          return (
            <tr
              key={item.id}
              className={`wl-table__row${isStock ? ' wl-table__row--selectable' : ''}${selected ? ' wl-table__row--selected' : ''}${drag.draggingId === item.id ? ' wl-table__row--dragging' : ''}`}
              {...drag.rowProps(item, item.tradingsymbol)}
              onClick={(e) => {
                // Buttons, links and the drag handle in the row keep their own actions.
                if (!isStock || (e.target as HTMLElement).closest('button, a, .wl-drag-handle')) return;
                onSelect(item);
              }}
              aria-selected={selected}
            >
              <td className="wl-table__td wl-table__td--symbol">
                <span className="wl-drag-handle" onMouseDown={() => drag.armRow(item.id)} title="Drag to move" aria-hidden="true">
                  <DragHandleIcon size={14} />
                </span>
                <span className="wl-symbol">{instrument ? getDisplayLabel(instrument) : item.tradingsymbol}</span>
                <TradingViewLink symbol={item.tradingsymbol} exchange={item.exchange} />
                <span className={`wl-exchange wl-exchange--${item.exchange.toLowerCase()}`}>{item.exchange}</span>
              </td>
              <td className={`wl-table__td wl-table__td--num ${changeColor}`}>{price ? formatPrice(price.ltp) : '—'}</td>
              <td className={`wl-table__td wl-table__td--num ${changeColor}`}>{change ? signed(change.abs, formatPrice(change.abs)) : '—'}</td>
              <td className={`wl-table__td wl-table__td--num ${changeColor}`}>{change ? signed(change.pct, `${change.pct.toFixed(2)}%`) : '—'}</td>
              <td className="wl-table__td wl-table__td--num">{price && price.high ? formatPrice(price.high) : '—'}</td>
              <td className="wl-table__td wl-table__td--num">{price && price.low ? formatPrice(price.low) : '—'}</td>
              <td className="wl-table__td wl-table__td--setup">
                {isStock ? (
                  <SetupChip scan={scans.get(item.instrumentToken)} onOpen={() => onOpenSetups(item)} />
                ) : <span className="wl-setup-chip wl-setup-chip--none">—</span>}
              </td>
              <td className="wl-table__td wl-table__td--action">
                <button
                  type="button"
                  className="wl-alert-btn"
                  onClick={() => onAlert(item)}
                  title="Create price alert"
                  aria-label={`Create price alert for ${item.tradingsymbol}`}
                >
                  <BellIcon size={14} />
                </button>
                <button
                  type="button"
                  className="wl-remove-btn"
                  onClick={() => onRemove(item)}
                  title="Remove from watchlist"
                  aria-label={`Remove ${item.tradingsymbol} from watchlist`}
                >
                  <TrashIcon size={14} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default WatchlistTable;
