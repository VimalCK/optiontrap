/**
 * Last prices by instrument token: quoted when the set changes, then ticked
 * while the market is open. Paper positions and pending orders share it, so
 * both show the same price.
 */
import { useEffect, useId, useState } from 'react';
import type { Tick } from '@/services/kiteTicker';
import { fetchQuotes } from '@/services/kiteApi';
import { positionQuoteKey } from '@/services/positions';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { isAbortError } from '@/services/apiClient';
import { useMarketStatus } from './useMarketStatus';
import { MarketStatus } from '../../shared/tradeEnums.js';

export interface PricedInstrument {
  instrumentToken: number;
  exchange: string;
  tradingsymbol: string;
}

/** One string per distinct instrument set, so effects rerun only when the set changes. */
export const instrumentsKey = (instruments: PricedInstrument[]): string =>
  [...new Set(instruments.map((i) => `${i.instrumentToken}|${positionQuoteKey(i)}`))].sort().join(',');

const parseInstrumentsKey = (key: string): Array<{ token: number; quoteKey: string }> =>
  key ? key.split(',').map((part) => {
    const [token, quote] = part.split('|');
    return { token: Number(token), quoteKey: quote };
  }) : [];

export function applyPriceTicks(prices: ReadonlyMap<number, number>, ticks: Tick[]): Map<number, number> {
  const next = new Map(prices);
  ticks.forEach((tick) => next.set(tick.instrumentToken, tick.lastPrice));
  return next;
}

/** A quote only fills gaps: a tick is newer than a quote. */
export function applyQuotedPrices(prices: ReadonlyMap<number, number>, quoted: ReadonlyMap<number, number>): Map<number, number> {
  const next = new Map(prices);
  quoted.forEach((price, token) => { if (!next.has(token)) next.set(token, price); });
  return next;
}

/** The last price of each instrument by token; an instrument not yet priced is missing. */
export function useLastPrices(name: string, instruments: PricedInstrument[]): Map<number, number> {
  const [prices, setPrices] = useState<Map<number, number>>(new Map());
  const marketStatus = useMarketStatus();
  const subscriberKey = `${name}-${useId()}`;
  const key = instrumentsKey(instruments);

  useEffect(() => {
    const items = parseInstrumentsKey(key);
    if (items.length === 0) return;
    const controller = new AbortController();
    fetchQuotes(items.map((item) => item.quoteKey), controller.signal)
      .then((quotes) => {
        const quoted = new Map<number, number>();
        items.forEach((item) => {
          const quote = quotes.get(item.quoteKey);
          if (quote && quote.last_price > 0) quoted.set(item.token, quote.last_price);
        });
        setPrices((prev) => applyQuotedPrices(prev, quoted));
      })
      .catch((err) => { if (!isAbortError(err)) console.warn(`[${name}] Failed to load quotes`, err); });
    return () => controller.abort();
  }, [key, name]);

  useEffect(() => {
    const tokens = parseInstrumentsKey(key).map((item) => item.token);
    if (tokens.length === 0 || marketStatus !== MarketStatus.Live) return;
    return tickerSubscribe(subscriberKey, tokens, (ticks) => setPrices((prev) => applyPriceTicks(prev, ticks)));
  }, [key, marketStatus, subscriberKey]);

  return prices;
}
