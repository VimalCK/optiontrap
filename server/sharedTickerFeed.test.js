import { describe, it, expect, vi } from 'vitest';
import { createSharedTickerFeed } from './sharedTickerFeed.js';

const ADMIN = { apiKey: 'k', accessToken: 't1' };

/** A shared feed over fake real feeds, recording each one opened. */
function setup() {
  const feeds = [];
  const open = createSharedTickerFeed({
    createFeed: (options) => {
      const feed = { options, watch: vi.fn(), close: vi.fn() };
      feeds.push(feed);
      return feed;
    },
  });
  const client = (kite = ADMIN) => {
    const handlers = { onTicks: vi.fn(), onAuthError: vi.fn() };
    return { ...handlers, feed: open({ kite, ...handlers }) };
  };
  const tick = (instrumentToken, lastPrice) => ({ instrumentToken, lastPrice });
  return { feeds, client, tick };
}

describe('createSharedTickerFeed', () => {
  it('opens one real feed for all clients, watching every client\'s instruments', () => {
    const { feeds, client } = setup();
    const monitor = client();
    const orders = client();
    monitor.feed.watch([1, 2]);
    orders.feed.watch([2, 3]);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].watch).toHaveBeenLastCalledWith([1, 2, 3]);
  });

  it('gives each client only the ticks of its own instruments', () => {
    const { feeds, client, tick } = setup();
    const monitor = client();
    const orders = client();
    monitor.feed.watch([1]);
    orders.feed.watch([2]);
    feeds[0].options.onTicks([tick(1, 10), tick(2, 20)]);
    expect(monitor.onTicks).toHaveBeenCalledWith([tick(1, 10)]);
    expect(orders.onTicks).toHaveBeenCalledWith([tick(2, 20)]);
    feeds[0].options.onTicks([tick(2, 21)]);
    expect(monitor.onTicks).toHaveBeenCalledTimes(1);
  });

  it('drops a closed client\'s instruments, and closes the real feed with the last client', () => {
    const { feeds, client } = setup();
    const monitor = client();
    const orders = client();
    monitor.feed.watch([1]);
    orders.feed.watch([2]);
    orders.feed.close();
    expect(feeds[0].watch).toHaveBeenLastCalledWith([1]);
    expect(feeds[0].close).not.toHaveBeenCalled();
    monitor.feed.close();
    expect(feeds[0].close).toHaveBeenCalled();
    client();
    expect(feeds).toHaveLength(2);
  });

  it('reopens the real feed for all clients when a client brings a new session', () => {
    const { feeds, client } = setup();
    client().feed.watch([1]);
    client({ apiKey: 'k', accessToken: 't2' });
    expect(feeds[0].close).toHaveBeenCalled();
    expect(feeds[1].options.kite.accessToken).toBe('t2');
    expect(feeds[1].watch).toHaveBeenLastCalledWith([1]);
  });

  it('tells every client when the session expires, and drops them all', () => {
    const { feeds, client } = setup();
    const monitor = client();
    const orders = client();
    feeds[0].options.onAuthError();
    expect(monitor.onAuthError).toHaveBeenCalled();
    expect(orders.onAuthError).toHaveBeenCalled();
    expect(feeds[0].close).toHaveBeenCalled();
    monitor.feed.close(); // what a client does on onAuthError: no effect now
    orders.feed.watch([5]);
    expect(feeds[0].watch).not.toHaveBeenCalledWith([5]);
  });
});
