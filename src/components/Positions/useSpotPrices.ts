import { useEffect, useState } from 'react';
import type { Position } from '@/services/positions';
import { fetchQuotes } from '@/services/kiteApi';
import type { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { underlyingFromSymbol } from '@/services/positionRisk';
import { loadUnderlyings, type Underlying } from '@/services/underlyings';
import { isMarketLive } from '@/utils/marketStatus';

interface SpotInstrument { token: number; quoteKey: string }

/** An underlying's price instrument (its index row, or the stock's NSE row). */
export function spotInstrument(name: string, underlyings: Underlying[]): SpotInstrument | null {
  const u = underlyings.find((item) => item.name === name);
  return u?.instrumentToken != null && u.tradingsymbol
    ? { token: u.instrumentToken, quoteKey: `${u.exchange}:${u.tradingsymbol}` }
    : null;
}

/** The spot price of each open position's underlying, by name: from ticks while the market is live, else from a quote. */
export function useSpotPrices(positions: Position[]): Map<string, number> {
  const [spotPrices, setSpotPrices] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const underlyings = [...new Set(positions.filter((p) => !p.exited).map((p) => underlyingFromSymbol(p.tradingsymbol)))];
    if (underlyings.length === 0) {
      setSpotPrices(new Map());
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const loadSpotPrices = async () => {
      const priceRows = await loadUnderlyings().catch(() => []);
      if (cancelled) return;

      const spotMeta = underlyings
        .map((underlying) => ({ underlying, spot: spotInstrument(underlying, priceRows) }))
        .filter((item): item is { underlying: string; spot: SpotInstrument } => item.spot != null);
      if (spotMeta.length === 0) return;

      if (isMarketLive()) {
        const byToken = new Map(spotMeta.map((item) => [item.spot.token, item.underlying]));
        unsubscribe = tickerSubscribe('paper-position-spots', [...byToken.keys()], (ticks: Tick[]) => {
          setSpotPrices((prev) => {
            const next = new Map(prev);
            ticks.forEach((tick) => {
              const underlying = byToken.get(tick.instrumentToken);
              if (underlying) next.set(underlying, tick.lastPrice);
            });
            return next;
          });
        });
        return;
      }

      const quotes = await fetchQuotes(spotMeta.map((item) => item.spot.quoteKey));
      if (cancelled) return;
      setSpotPrices((prev) => {
        const next = new Map(prev);
        spotMeta.forEach((item) => {
          const quote = quotes.get(item.spot.quoteKey);
          if (quote && quote.last_price > 0) next.set(item.underlying, quote.last_price);
        });
        return next;
      });
    };

    loadSpotPrices();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [positions]);

  return spotPrices;
}
