import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ tryHoldNamedAdvisoryLock: vi.fn() }));

const { createTradeEngine } = await import('./host.js');

/** A market clock that records what plug-ins subscribe, and starts / stops on demand. */
function fakeMarket() {
  const disposed = [];
  return {
    disposed,
    started: 0,
    stopped: 0,
    start() { this.started += 1; },
    stop() { this.stopped += 1; },
    forPlugin: (id) => ({ isOpen: () => true, onOpen: () => () => {}, onClose: () => () => {}, every: () => () => {}, dispose: () => disposed.push(id) }),
  };
}

function setup({ lock = { release: vi.fn(async () => {}) }, services, strategies } = {}) {
  const order = [];
  const plugin = (id, extra = {}) => ({
    id,
    start: vi.fn(async () => { order.push(`start ${id}`); }),
    stop: vi.fn(async () => { order.push(`stop ${id}`); }),
    status: () => ({ beats: 1 }),
    ...extra,
  });
  const market = fakeMarket();
  const timers = [];
  const logs = [];
  const holdLock = vi.fn(async () => lock);
  const engine = createTradeEngine({
    services: services ?? [plugin('orders'), plugin('signals')],
    strategies: strategies ?? [plugin('setups')],
    market,
    holdLock,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
    logFor: (name) => (event, details) => logs.push([name, event, details]),
  });
  return { engine, order, market, timers, logs, holdLock, plugin };
}

describe('the trade engine host', () => {
  it('starts services, then strategies, then the market clock; stops in reverse and frees the lock', async () => {
    const lock = { release: vi.fn(async () => {}) };
    const { engine, order, market } = setup({ lock });
    await engine.start();
    expect(order).toEqual(['start orders', 'start signals', 'start setups']);
    expect(market.started).toBe(1);
    expect(engine.status().running).toBe(true);
    await engine.stop();
    expect(order.slice(3)).toEqual(['stop setups', 'stop signals', 'stop orders']);
    expect(market.disposed).toEqual(['setups', 'signals', 'orders']);
    expect(lock.release).toHaveBeenCalled();
    expect(engine.status().running).toBe(false);
  });

  it('gives each plug-in the services by id, its own market scope and log', async () => {
    const { engine, plugin } = setup();
    const strategy = plugin('setups');
    const { engine: withStrategy } = setup({ strategies: [strategy] });
    await withStrategy.start();
    const ctx = strategy.start.mock.calls[0][0];
    expect(Object.keys(ctx.services)).toEqual(['orders', 'signals']);
    expect(typeof ctx.market.every).toBe('function');
    expect(typeof ctx.log).toBe('function');
    expect(engine.services).toHaveProperty('orders');
  });

  it('keeps every other plug-in running when one fails to start, and shows the failure', async () => {
    const { engine, logs } = setup({
      strategies: [
        { id: 'broken', start: async () => { throw new Error('no data'); } },
        { id: 'setups', start: async () => {} },
      ],
    });
    await engine.start();
    const states = Object.fromEntries(engine.status().plugins.map((p) => [p.id, [p.state, p.error]]));
    expect(states).toEqual({ orders: ['running', null], signals: ['running', null], broken: ['failed', 'no data'], setups: ['running', null] });
    expect(logs).toContainEqual(['Engine', 'could not start', { plugin: 'broken', error: 'no data' }]);
  });

  it("shows each running plug-in's own status", async () => {
    const { engine } = setup();
    await engine.start();
    expect(engine.status().plugins[0]).toEqual({ id: 'orders', kind: 'service', state: 'running', error: null, beats: 1 });
  });

  it('stands by when another server holds the lock, and starts once it can take it', async () => {
    const { engine, order, timers, holdLock } = setup();
    holdLock.mockResolvedValueOnce(null);
    await engine.start();
    expect(order).toEqual([]);
    expect(engine.status().running).toBe(false);
    expect(timers).toHaveLength(1);
    await timers[0]();
    await vi.waitFor(() => expect(order).toEqual(['start orders', 'start signals', 'start setups']));
  });

  it('stops running and stands by when the lock is lost', async () => {
    const { engine, order, timers, holdLock } = setup();
    let lose;
    holdLock.mockImplementationOnce(async (_name, onLost) => { lose = onLost; return { release: async () => {} }; });
    await engine.start();
    lose();
    await vi.waitFor(() => expect(engine.status().running).toBe(false));
    expect(order).toContain('stop orders');
    expect(timers).toHaveLength(1);
  });
});
