import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getDisplayLabel, searchInstruments, type Instrument } from '@/services/instruments';
import type { WatchlistItem } from '@/services/watchlist';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { InstrumentType } from '../../../shared/tradeEnums.js';
import { searchHits } from './watchlistRows';

/** The search box that adds an instrument to the open list; arrow keys and Enter pick a result. */
const InstrumentSearch: React.FC<{
  instruments: Instrument[];
  items: WatchlistItem[];
  itemCount: number;
  /** Resolves to whether it was added. */
  onAdd: (instrument: Instrument) => Promise<boolean>;
}> = ({ instruments, items, itemCount, onAdd }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setShowDropdown(false), []);
  useDismissOnOutside(showDropdown, searchRef, closeDropdown);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    const hits = searchHits(instruments, items, (list) => searchInstruments(list, query));
    setResults(hits);
    setShowDropdown(hits.length > 0);
    setHighlightIdx(-1);
  }, [query, instruments, items]);

  const add = async (instrument: Instrument) => {
    if (!(await onAdd(instrument))) return;
    setQuery('');
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      void add(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div className="wl-search" ref={searchRef}>
      <input
        className="wl-search__input"
        placeholder="Search & add instrument (e.g. RELIANCE, TCS)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setShowDropdown(true);
        }}
      />
      <span className="wl-search__count">{itemCount}/100</span>

      {showDropdown && (
        <div className="wl-search__dropdown">
          {results.map((inst, idx) => (
            <button
              type="button"
              key={inst.instrumentToken}
              className={`wl-search__result ${idx === highlightIdx ? 'wl-search__result--active' : ''}`}
              onClick={() => void add(inst)}
              onMouseEnter={() => setHighlightIdx(idx)}
            >
              <span className="wl-search__result-symbol">{getDisplayLabel(inst)}</span>
              <span className="wl-search__result-name">{inst.instrumentType === InstrumentType.EQ ? inst.name : inst.tradingsymbol}</span>
              <span className={`wl-search__result-exchange wl-exchange--${inst.exchange.toLowerCase()}`}>{inst.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default InstrumentSearch;
