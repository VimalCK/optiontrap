import type { Tick } from '@/services/kiteTicker';
import type { Instrument } from '@/services/instruments';
import type { WatchlistItem } from '@/services/watchlist';

export interface LivePrice {
  ltp: number;
  close: number;
  high: number;
  low: number;
}

export const formatPrice = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The prices with each tick whose LTP moved; the same map when none did, so nothing re-renders. */
export function withPriceTicks(prev: Map<number, LivePrice>, ticks: Tick[]): Map<number, LivePrice> {
  let changed = false;
  const next = new Map(prev);
  for (const t of ticks) {
    const existing = next.get(t.instrumentToken);
    if (existing && existing.ltp === t.lastPrice) continue;
    next.set(t.instrumentToken, {
      ltp: t.lastPrice,
      close: t.closePrice ?? existing?.close ?? 0,
      high: t.highPrice ?? existing?.high ?? 0,
      low: t.lowPrice ?? existing?.low ?? 0,
    });
    changed = true;
  }
  return changed ? next : prev;
}

/** The move from the previous close; zero while the close is unknown. */
export function priceChange(price: LivePrice): { abs: number; pct: number } {
  if (!price.close) return { abs: 0, pct: 0 };
  const abs = price.ltp - price.close;
  return { abs, pct: (abs / price.close) * 100 };
}

export const changeClass = (change: { abs: number } | null) => {
  if (!change || change.abs === 0) return '';
  return change.abs > 0 ? 'wl-cell--up' : 'wl-cell--down';
};

/** Search hits not already in the list. */
export function searchHits(instruments: Instrument[], items: WatchlistItem[], search: (list: Instrument[]) => Instrument[]): Instrument[] {
  const existingTokens = new Set(items.map((i) => i.instrumentToken));
  return search(instruments).filter((r) => !existingTokens.has(r.instrumentToken));
}

/** The list with `movingId` moved to where `targetId` is. */
export function moveItem<T extends { id: string }>(items: T[], movingId: string, targetId: string): T[] {
  const from = items.findIndex((i) => i.id === movingId);
  const to = items.findIndex((i) => i.id === targetId);
  if (from < 0 || to < 0) return items;
  const next = [...items];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export const sameOrder = (a: { id: string }[], b: { id: string }[]) => a.every((item, i) => item.id === b[i]?.id);
