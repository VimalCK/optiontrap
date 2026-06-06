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

// Module-level singleton state
let ticker: KiteTicker | null = null;
const subscribers = new Map<string, Subscriber>();

/** Merge all tokens across all subscribers into one flat set */
function allTokens(): number[] {
  const merged = new Set<number>();
  subscribers.forEach((sub) => sub.tokens.forEach((t) => merged.add(t)));
  return Array.from(merged);
}

/** Fan out incoming ticks to every subscriber that cares about each token */
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
  if (ticker) return; // already connected
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

/**
 * Subscribe to ticks for the given tokens.
 *
 * @param id        Unique subscriber ID (e.g. component name + instance key)
 * @param tokens    Instrument tokens to receive ticks for
 * @param callback  Called with filtered ticks on every tick batch
 * @returns         Cleanup function — call on component unmount
 */
export function tickerSubscribe(
  id: string,
  tokens: number[],
  callback: TickCallback,
): () => void {
  subscribers.set(id, { tokens: new Set(tokens), callback });

  // If the ticker is already connected, subscribe the new tokens immediately
  if (ticker && tokens.length > 0) {
    // KiteTicker.connect() re-subscribes all tokens; instead we reach into the
    // underlying subscribe+mode mechanism by reconnecting with the full merged set.
    // Simplest safe approach: disconnect and reconnect with merged tokens.
    ticker.disconnect();
    ticker = new KiteTicker();
    ticker.connect(allTokens(), handleTicks);
  }

  return () => {
    subscribers.delete(id);
    // No need to reconnect when unsubscribing — extra subscriptions on Kite's
    // side are harmless (ticks for unclaimed tokens are simply ignored).
  };
}

/**
 * Update the token set for an existing subscriber without re-registering the callback.
 * Triggers a reconnect to re-subscribe with the new merged token set.
 */
export function tickerUpdateTokens(id: string, tokens: number[]): void {
  const sub = subscribers.get(id);
  if (!sub) return;
  sub.tokens = new Set(tokens);

  if (ticker) {
    ticker.disconnect();
    ticker = new KiteTicker();
    ticker.connect(allTokens(), handleTicks);
  }
}
