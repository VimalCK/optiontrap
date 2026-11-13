/**
 * Kite allows only 3 ticker connections per API key, so the trade monitor and order service share one real feed. Each
 * client has the shape of a kiteTickerFeed.js feed ({ watch, close }) and gets the ticks of its own instruments.
 *
 * - A client with a different Kite session (the admin logged in again) reopens the real feed with it, for all clients.
 * - When the session expires (a 403), every client hears onAuthError and is dropped.
 */
import { createKiteTickerFeed } from './kiteTickerFeed.js';

/**
 * @typedef {import('../shared/kiteTicks.js').Tick} Tick
 * @typedef {import('./kiteTickerFeed.js').KiteSession} KiteSession
 * @typedef {{ tokens: Set<number>, onTicks: (ticks: Tick[]) => void, onAuthError: () => void }} Client
 */

/**
 * @param {{ createFeed?: typeof createKiteTickerFeed }} [deps]
 * @returns {typeof createKiteTickerFeed}
 */
export function createSharedTickerFeed({ createFeed = createKiteTickerFeed } = {}) {
  /** @type {Set<Client>} */
  const clients = new Set();
  /** @type {ReturnType<typeof createKiteTickerFeed> | null} */
  let feed = null;
  /** @type {KiteSession | null} */
  let session = null;

  const allTokens = () => [...new Set([...clients].flatMap((c) => [...c.tokens]))];
  const sameSession = (/** @type {KiteSession} */ kite) => session?.apiKey === kite.apiKey && session?.accessToken === kite.accessToken;

  function closeFeed() {
    feed?.close();
    feed = null;
    session = null;
  }

  function dispatch(/** @type {Tick[]} */ ticks) {
    for (const client of clients) {
      const own = ticks.filter((t) => client.tokens.has(t.instrumentToken));
      if (own.length > 0) client.onTicks(own);
    }
  }

  function authError() {
    const dropped = [...clients];
    clients.clear();
    closeFeed();
    for (const client of dropped) client.onAuthError();
  }

  /** Open the real feed with this session, unless it is already open with it. */
  function openFeed(/** @type {KiteSession} */ kite) {
    if (feed && sameSession(kite)) return;
    closeFeed();
    session = kite;
    feed = createFeed({ kite, onTicks: dispatch, onAuthError: authError });
    feed.watch(allTokens());
  }

  return ({ kite, onTicks, onAuthError }) => {
    /** @type {Client} */
    const client = { tokens: new Set(), onTicks, onAuthError };
    clients.add(client);
    openFeed(kite);
    return {
      /** Watch exactly these instruments for this client. */
      watch(/** @type {number[]} */ tokens) {
        if (!clients.has(client)) return;
        client.tokens = new Set(tokens);
        feed?.watch(allTokens());
      },
      close() {
        if (!clients.delete(client)) return;
        if (clients.size === 0) closeFeed();
        else feed?.watch(allTokens());
      },
    };
  };
}

export const openSharedTickerFeed = createSharedTickerFeed();
