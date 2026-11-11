/**
 * One Kite ticker feed shared by everything on the server that needs live
 * prices: the trade engine's trade monitor and order service
 * (server/tradeEngine/services/tradeMonitor.js, orders.js).
 *
 * Kite allows only 3 ticker connections per API key, so each of them can't
 * open its own feed. Each opens a client here instead, with the same shape
 * as a kiteTickerFeed.js feed ({ watch, close }): the real feed watches every
 * client's instruments together, and each client gets the ticks of its own.
 *
 * - The first client opens the real feed; when the last one closes, it closes.
 * - A client with a different Kite session (the admin logged in again)
 *   reopens the real feed with it, for all clients.
 * - When the session expires (a 403), every client hears onAuthError and is
 *   dropped, as with its own feed; each opens again at its next check.
 */
import { createKiteTickerFeed } from './kiteTickerFeed.js';

/**
 * @typedef {import('../shared/kiteTicks.js').Tick} Tick
 * @typedef {import('./kiteTickerFeed.js').KiteSession} KiteSession
 * @typedef {{ tokens: Set<number>, onTicks: (ticks: Tick[]) => void, onAuthError: () => void }} Client
 */

/**
 * A factory of feed clients sharing one real feed.
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

/** The server's one shared feed. */
export const openSharedTickerFeed = createSharedTickerFeed();
