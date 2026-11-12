/**
 * The server's own Kite ticker feed: live last prices for a set of
 * instruments, with no browser involved. Used through sharedTickerFeed.js by
 * the trade engine's order service and trade monitor (server/tradeEngine/services/).
 *
 * Opens WebSocket connections to wss://ws.kite.trade with one Kite session
 * (the admin's, as the OI snapshots use) and subscribes in LTP mode, the
 * smallest packet: only the last traded price is needed. Prices are market
 * data, the same for every user, so one feed serves all users.
 *
 * Kite allows 3 connections per API key and 3000 instruments per connection,
 * so the instruments are spread over up to 3 connections; any beyond 9000
 * aren't watched and are logged. A dropped connection reconnects; a 403 (the
 * session expired) calls onAuthError instead, since retrying can't help.
 * Ticks are read with the parser shared with the browser (shared/kiteTicks.js).
 */
import { WebSocket } from 'ws';
import { parseTicks } from '../shared/kiteTicks.js';
import { TickerMode } from '../shared/tradeEnums.js';

/** Kite's limits per API key. */
export const MAX_TOKENS_PER_CONNECTION = 3000;
export const MAX_CONNECTIONS = 3;
const RECONNECT_DELAY_MS = 5000;
const KITE_TICKER_URL = 'wss://ws.kite.trade';

/**
 * Kite's ticker URL for one Kite login, with the key and token encoded as query values.
 * Used by this feed and by the browser proxy (`/ws` in server/index.js).
 * @param {{ apiKey: string, accessToken: string }} kite
 */
export function kiteTickerUrl(kite) {
  return `${KITE_TICKER_URL}?api_key=${encodeURIComponent(kite.apiKey)}&access_token=${encodeURIComponent(kite.accessToken)}`;
}

/**
 * @typedef {import('../shared/kiteTicks.js').Tick} Tick
 * @typedef {{ apiKey: string, accessToken: string }} KiteSession
 * @typedef {(url: string) => any} OpenSocket  opens a WebSocket (injected in tests)
 */

/**
 * Split the instruments into one group per connection, Kite's limits applied.
 * @param {number[]} tokens
 * @returns {{ groups: number[][], unwatched: number[] }}
 */
export function groupTokens(tokens) {
  const sorted = [...new Set(tokens)].sort((a, b) => a - b);
  const groups = [];
  for (let i = 0; i < sorted.length && groups.length < MAX_CONNECTIONS; i += MAX_TOKENS_PER_CONNECTION) {
    groups.push(sorted.slice(i, i + MAX_TOKENS_PER_CONNECTION));
  }
  return { groups, unwatched: sorted.slice(MAX_CONNECTIONS * MAX_TOKENS_PER_CONNECTION) };
}

/** A Node Buffer's bytes as the ArrayBuffer the shared parser reads. */
const toArrayBuffer = (/** @type {Buffer} */ data) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

/**
 * One connection and the instruments it is subscribed to.
 * @param {{ url: string, openSocket: OpenSocket, onTicks: (ticks: Tick[]) => void, onAuthError: () => void, log: (message: string) => void }} options
 */
function createConnection({ url, openSocket, onTicks, onAuthError, log }) {
  /** @type {number[]} */
  let tokens = [];
  let socket = null;
  let closed = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;

  const send = (/** @type {object} */ message) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const subscribe = (/** @type {number[]} */ list) => {
    if (list.length === 0) return;
    send({ a: 'subscribe', v: list });
    send({ a: 'mode', v: [TickerMode.ltp, list] });
  };

  function open() {
    socket = openSocket(url);
    socket.on('open', () => subscribe(tokens));
    socket.on('message', (/** @type {Buffer} */ data, /** @type {boolean} */ isBinary) => {
      if (!isBinary) return; // text messages are order updates and errors, not prices
      const ticks = parseTicks(toArrayBuffer(data));
      if (ticks.length > 0) onTicks(ticks);
    });
    socket.on('unexpected-response', (/** @type {any} */ _req, /** @type {any} */ res) => {
      res.resume();
      log(`Kite ticker refused the connection: HTTP ${res.statusCode}`);
      if (res.statusCode === 403) {
        closed = true;
        onAuthError();
      }
      socket.terminate();
    });
    socket.on('error', (/** @type {Error} */ err) => log(`Kite ticker error: ${err.message}`));
    socket.on('close', () => {
      if (closed) return;
      reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS);
    });
  }

  return {
    /** Subscribe to exactly `next`, sending only the difference. */
    setTokens(/** @type {number[]} */ next) {
      const nextSet = new Set(next);
      const currentSet = new Set(tokens);
      const removed = tokens.filter((t) => !nextSet.has(t));
      if (removed.length > 0) send({ a: 'unsubscribe', v: removed });
      subscribe(next.filter((t) => !currentSet.has(t)));
      tokens = next;
      if (!socket) open();
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}

/**
 * A feed of last prices for whatever instruments it is told to watch.
 * @param {{
 *   kite: KiteSession,
 *   onTicks: (ticks: Tick[]) => void,
 *   onAuthError: () => void,
 *   openSocket?: OpenSocket,
 *   log?: (message: string) => void,
 * }} options
 */
export function createKiteTickerFeed({ kite, onTicks, onAuthError, openSocket = (url) => new WebSocket(url), log = console.log }) {
  const url = kiteTickerUrl(kite);
  /** @type {ReturnType<typeof createConnection>[]} */
  let connections = [];

  return {
    /** Watch exactly these instruments: subscribes and unsubscribes as needed. */
    watch(/** @type {number[]} */ tokens) {
      const { groups, unwatched } = groupTokens(tokens);
      if (unwatched.length > 0) log(`Kite ticker: ${unwatched.length} instrument(s) over Kite's limit are not watched`);
      while (connections.length < groups.length) connections.push(createConnection({ url, openSocket, onTicks, onAuthError, log }));
      for (const extra of connections.splice(groups.length)) extra.close();
      groups.forEach((group, i) => connections[i].setTokens(group));
    },
    close() {
      for (const connection of connections) connection.close();
      connections = [];
    },
  };
}
