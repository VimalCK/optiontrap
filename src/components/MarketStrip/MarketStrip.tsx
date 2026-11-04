import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTabsThatFit } from '@/hooks/useTabsThatFit';
import { useUnderlyings } from '@/hooks/useUnderlyings';
import { fetchQuotes } from '@/services/kiteApi';
import { tickerSubscribe } from '@/services/tickerSingleton';
import type { Tick } from '@/services/kiteTicker';
import './MarketStrip.css';

interface Price { last: number; close: number }

/** Account pages, where market prices are not needed. */
const HIDDEN_ON = ['/admin', '/settings', '/profile'];

/** At most this many symbols show in the corner (fewer when the row is narrow); the rest open from "+N". */
const INLINE_COUNT = 2;

/** Space kept between a page's tab bar and the strip. */
const STRIP_GAP = 24;

const formatPrice = (value: number) => value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The always-snapshot symbols (Settings) with their price and day change, top right
 * of every page. Starts from a quote, then follows live ticks while the market is open.
 * The first few show inline, as many as fit in half the row; the rest are listed in a dropdown.
 */
const MarketStripSymbols: React.FC = () => {
  const underlyings = useUnderlyings();
  const symbols = useMemo(
    // The market reference (the index the app compares stocks against) first, so it is never hidden.
    () => underlyings
      .filter((u) => u.alwaysSnapshot && u.instrumentToken != null && u.exchange && u.tradingsymbol)
      .sort((a, b) => Number(b.isMarketReference) - Number(a.isMarketReference)),
    [underlyings],
  );
  const [prices, setPrices] = useState<Map<number, Price>>(new Map());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const noTrailingRef = useRef<HTMLDivElement>(null);
  const fitting = useTabsThatFit(boxRef, measureRef, noTrailingRef, -1, INLINE_COUNT);
  const tokensKey = symbols.map((u) => u.instrumentToken).join(',');

  useEffect(() => {
    if (symbols.length === 0) return;
    const controller = new AbortController();
    fetchQuotes(symbols.map((u) => `${u.exchange}:${u.tradingsymbol}`), controller.signal)
      .then((quotes) => {
        setPrices((prev) => {
          const next = new Map(prev);
          for (const u of symbols) {
            const quote = quotes.get(`${u.exchange}:${u.tradingsymbol}`);
            if (quote?.last_price) next.set(u.instrumentToken!, { last: quote.last_price, close: quote.ohlc.close });
          }
          return next;
        });
      })
      .catch(() => { /* ticks fill in once the market moves */ });

    const unsubscribe = tickerSubscribe('market-strip', symbols.map((u) => u.instrumentToken!), (ticks: Tick[]) => {
      setPrices((prev) => {
        const next = new Map(prev);
        for (const tick of ticks) {
          const close = tick.closePrice || prev.get(tick.instrumentToken)?.close || 0;
          next.set(tick.instrumentToken, { last: tick.lastPrice, close });
        }
        return next;
      });
    });
    return () => { controller.abort(); unsubscribe(); };
    // Re-run only when the set of tokens changes, not on every underlyings reload.
  }, [tokensKey]);

  // Close the dropdown on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Tell the page how much of its first row the strip takes (--market-strip-space on
  // .content__inner), so the tab bar stops short of it instead of running under it.
  const shown = symbols.length > 0;
  useLayoutEffect(() => {
    const strip = rootRef.current;
    const page = boxRef.current?.parentElement;
    if (!strip || !page) return;
    const update = () => page.style.setProperty('--market-strip-space', `${Math.ceil(strip.offsetWidth) + STRIP_GAP}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => { observer.disconnect(); page.style.removeProperty('--market-strip-space'); };
  }, [shown]);

  if (!shown) return null;

  const renderItem = (u: (typeof symbols)[number], className: string) => {
    const price = prices.get(u.instrumentToken!);
    const change = price && price.close > 0 ? price.last - price.close : null;
    const changePct = change != null && price ? (change / price.close) * 100 : null;
    const direction = change == null || change === 0 ? '' : change > 0 ? ' market-strip__change--up' : ' market-strip__change--down';
    return (
      <div key={u.name} className={className}>
        <span className="market-strip__label">{u.label}</span>
        <span className="market-strip__price">{price ? formatPrice(price.last) : '—'}</span>
        <span className={`market-strip__change${direction}`}>
          {change != null && changePct != null
            ? `${change > 0 ? '+' : ''}${formatPrice(change)} (${change > 0 ? '+' : ''}${changePct.toFixed(2)}%)`
            : ''}
        </span>
      </div>
    );
  };

  const inline = fitting ? symbols.filter((_, i) => fitting.has(i)) : symbols.slice(0, INLINE_COUNT);
  const more = symbols.filter((u) => !inline.includes(u));

  return (
    // The box is the room the strip may take (half the row); the strip inside is what it uses.
    <div className="market-strip-box" ref={boxRef}>
    {/* Hidden copy of every symbol and a "+N" button, measured to decide how many fit. */}
    <div className="market-strip market-strip--measure" ref={measureRef} aria-hidden="true">
      {symbols.map((u) => renderItem(u, 'market-strip__item'))}
      <span className="market-strip__more-btn">+{symbols.length} ▾</span>
    </div>
    <div className="market-strip" ref={rootRef}>
      {inline.map((u) => renderItem(u, 'market-strip__item'))}
      {more.length > 0 && (
        <div className="market-strip__more">
          <button
            type="button"
            className={`market-strip__more-btn${open ? ' market-strip__more-btn--open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            +{more.length} ▾
          </button>
          {open && <div className="market-strip__dropdown">{more.map((u) => renderItem(u, 'market-strip__row'))}</div>}
        </div>
      )}
    </div>
    </div>
  );
};

/** The strip, except on the account pages; hidden, it holds no ticker subscription. */
const MarketStrip: React.FC = () => {
  const { pathname } = useLocation();
  if (HIDDEN_ON.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;
  return <MarketStripSymbols />;
};

export default MarketStrip;
