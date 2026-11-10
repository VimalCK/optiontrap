import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createKiteTickerFeed, groupTokens, kiteTickerUrl, MAX_CONNECTIONS, MAX_TOKENS_PER_CONNECTION } from './kiteTickerFeed.js';

/** Stands in for a ws WebSocket: records what is sent and lets a test emit events. */
class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
  }
  open() { this.readyState = 1; this.emit('open'); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}

/** A binary LTP message for these [token, paise] pairs, as Kite sends it (a Node Buffer). */
function ltpMessage(...pairs) {
  const buffer = Buffer.alloc(2 + pairs.length * 10);
  buffer.writeInt16BE(pairs.length, 0);
  pairs.forEach(([token, paise], i) => {
    const at = 2 + i * 10;
    buffer.writeInt16BE(8, at);
    buffer.writeInt32BE(token, at + 2);
    buffer.writeInt32BE(paise, at + 6);
  });
  return buffer;
}

let sockets;
let onTicks;
let onAuthError;
const feed = () => createKiteTickerFeed({
  kite: { apiKey: 'key', accessToken: 'token' },
  onTicks,
  onAuthError,
  openSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
  log: () => {},
});

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  onTicks = vi.fn();
  onAuthError = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('groupTokens', () => {
  it("spreads instruments over connections by Kite's limits, sorted and without repeats", () => {
    expect(groupTokens([3, 1, 2, 1])).toEqual({ groups: [[1, 2, 3]], unwatched: [] });
    const many = Array.from({ length: MAX_TOKENS_PER_CONNECTION * MAX_CONNECTIONS + 2 }, (_, i) => i + 1);
    const { groups, unwatched } = groupTokens(many);
    expect(groups.map((g) => g.length)).toEqual([MAX_TOKENS_PER_CONNECTION, MAX_TOKENS_PER_CONNECTION, MAX_TOKENS_PER_CONNECTION]);
    expect(unwatched).toEqual([9001, 9002]);
    expect(groupTokens([])).toEqual({ groups: [], unwatched: [] });
  });
});

describe('createKiteTickerFeed', () => {
  it("connects with the session and subscribes the instruments in LTP mode once open", () => {
    feed().watch([101, 102]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://ws.kite.trade?api_key=key&access_token=token');
    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ a: 'subscribe', v: [101, 102] }, { a: 'mode', v: ['ltp', [101, 102]] }]);
  });

  it('subscribes and unsubscribes only the difference when the instruments change', () => {
    const f = feed();
    f.watch([101, 102]);
    sockets[0].open();
    sockets[0].sent = [];
    f.watch([102, 103]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([{ a: 'unsubscribe', v: [101] }, { a: 'subscribe', v: [103] }, { a: 'mode', v: ['ltp', [103]] }]);
  });

  it('passes binary messages on as ticks and ignores text messages', () => {
    feed().watch([101]);
    sockets[0].open();
    sockets[0].emit('message', ltpMessage([101, 12050]), true);
    sockets[0].emit('message', Buffer.from('{"type":"order"}'), false);
    expect(onTicks).toHaveBeenCalledTimes(1);
    expect(onTicks).toHaveBeenCalledWith([{ instrumentToken: 101, lastPrice: 120.5 }]);
  });

  it('reconnects after a dropped connection and subscribes again', () => {
    feed().watch([101]);
    sockets[0].open();
    sockets[0].emit('close');
    vi.advanceTimersByTime(5000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].sent[0]).toEqual({ a: 'subscribe', v: [101] });
  });

  it('reports an expired session (403) instead of reconnecting', () => {
    feed().watch([101]);
    sockets[0].emit('unexpected-response', {}, { statusCode: 403, resume: () => {} });
    vi.advanceTimersByTime(60_000);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  it('closes connections it no longer needs, and everything on close, without reconnecting', () => {
    const f = feed();
    f.watch([101]);
    sockets[0].open();
    f.watch([]);
    expect(sockets[0].closed).toBe(true);
    f.watch([102]);
    f.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].closed).toBe(true);
  });
});

describe('kiteTickerUrl', () => {
  it("encodes the key and token so they can't add parameters to Kite's URL", () => {
    const url = new URL(kiteTickerUrl({ apiKey: 'key&x=1', accessToken: 'tok#frag' }));
    expect([...url.searchParams.keys()]).toEqual(['api_key', 'access_token']);
    expect(url.searchParams.get('api_key')).toBe('key&x=1');
    expect(url.searchParams.get('access_token')).toBe('tok#frag');
  });
});
