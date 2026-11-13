/**
 * Singleton KiteTicker — one WebSocket connection shared across the entire app.
 *
 * Kite Connect allows only one WebSocket connection per session. This module
 * manages a single KiteTicker instance and fans out ticks to all registered
 * subscribers. Components subscribe with a set of tokens + a callback and
 * receive an unsubscribe function to call on cleanup.
 *
 * Usage:
 *   // In component effect:
 *   const unsub = tickerSubscribe('holdings', tokens, (ticks) => { ... });
 *   return () => unsub();
 *
 *   // In App.tsx on session change:
 *   tickerConnect();   // when session becomes non-null
 *   tickerDisconnect(); // on logout / 403
 */

import { KiteTicker, Tick } from './kiteTicker';

type TickCallback = (ticks: Tick[]) => void;

interface Subscriber {
  tokens: Set<number>;
  callback: TickCallback;
}

let ticker: KiteTicker | null = null;
const subscribers = new Map<string, Subscriber>();

function allTokens(): number[] {
  const merged = new Set<number>();
  subscribers.forEach((sub) => sub.tokens.forEach((t) => merged.add(t)));
  return Array.from(merged);
}

function handleTicks(ticks: Tick[]): void {
  subscribers.forEach((sub) => {
    const relevant = ticks.filter((t) => sub.tokens.has(t.instrumentToken));
    if (relevant.length > 0) {
      sub.callback(relevant);
    }
  });
}

/**
 * Connect the singleton ticker. Call once when a valid session is available.
 * Safe to call multiple times — reconnects only if not already connected.
 */
export function tickerConnect(): void {
  if (ticker) return;
  ticker = new KiteTicker();
  const tokens = allTokens();
  if (tokens.length > 0) {
    ticker.connect(tokens, handleTicks);
  }
}

/**
 * Disconnect and destroy the singleton. Call on logout or session expiry.
 */
export function tickerDisconnect(): void {
  if (ticker) {
    ticker.disconnect();
    ticker = null;
  }
}

/** Subscribes to ticks; returns the function that unsubscribes (call it on unmount). */
export function tickerSubscribe(
  id: string,
  tokens: number[],
  callback: TickCallback,
): () => void {
  subscribers.set(id, { tokens: new Set(tokens), callback });

  // Update subscriptions incrementally — no disconnect/reconnect needed.
  if (ticker) {
    const merged = allTokens();
    if (!ticker.active && merged.length > 0) {
      // WebSocket was never opened (no subscribers when tickerConnect ran)
      ticker.connect(merged, handleTicks);
    } else {
      ticker.updateSubscriptions(merged);
    }
  }

  return () => {
    subscribers.delete(id);
    if (ticker) {
      ticker.updateSubscriptions(allTokens());
    }
  };
}

/** Replaces the token set of an existing subscriber, keeping its callback. */
export function tickerUpdateTokens(id: string, tokens: number[]): void {
  const sub = subscribers.get(id);
  if (!sub) return;
  sub.tokens = new Set(tokens);

  // Update subscriptions incrementally — no disconnect/reconnect needed.
  if (ticker) {
    const merged = allTokens();
    if (!ticker.active && merged.length > 0) {
      ticker.connect(merged, handleTicks);
    } else {
      ticker.updateSubscriptions(merged);
    }
  }
}
