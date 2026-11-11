import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMarket } from './market.js';

const OPEN = new Date('2026-11-12T04:00:00Z'); // Thu 09:30 IST
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('the market clock', () => {
  let now;
  let open;
  let errors;
  let market;

  beforeEach(() => {
    now = OPEN;
    open = true;
    errors = [];
    market = createMarket({
      clock: () => now,
      isOpen: () => open,
      onError: (pluginId, err) => errors.push([pluginId, err.message]),
      setTimer: () => 'timer',
      clearTimer: () => {},
    });
  });

  const later = (ms) => { now = new Date(now.getTime() + ms); };

  it('fires open at once when started in market hours, then close once when it closes', () => {
    const plugin = market.forPlugin('p');
    const opened = vi.fn();
    const closed = vi.fn();
    plugin.onOpen(opened);
    plugin.onClose(closed);
    market.start();
    expect(opened).toHaveBeenCalledTimes(1);
    market.tick();
    expect(opened).toHaveBeenCalledTimes(1);
    open = false;
    market.tick();
    market.tick();
    expect(closed).toHaveBeenCalledTimes(1);
    open = true;
    market.tick();
    expect(opened).toHaveBeenCalledTimes(2); // the next session
  });

  it('fires close once when started after the close, so missed cleanup still happens', () => {
    open = false;
    const plugin = market.forPlugin('p');
    const opened = vi.fn();
    const closed = vi.fn();
    plugin.onOpen(opened);
    plugin.onClose(closed);
    market.start();
    market.tick();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it('repeats only while open, first at the open, then every interval', async () => {
    const plugin = market.forPlugin('p');
    const beat = vi.fn();
    plugin.every(30_000, beat);
    market.start();
    expect(beat).toHaveBeenCalledTimes(1);
    later(10_000);
    await settle();
    market.tick();
    expect(beat).toHaveBeenCalledTimes(1);
    later(20_000);
    await settle();
    market.tick();
    expect(beat).toHaveBeenCalledTimes(2);
    open = false;
    later(60_000);
    await settle();
    market.tick();
    expect(beat).toHaveBeenCalledTimes(2);
    open = true;
    later(1_000);
    await settle();
    market.tick();
    expect(beat).toHaveBeenCalledTimes(3); // at the next open, not 30 s after the last beat
  });

  it('never overlaps a repeat that is still running', async () => {
    const plugin = market.forPlugin('p');
    let finish;
    const beat = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    plugin.every(1_000, beat);
    market.start();
    later(5_000);
    market.tick();
    expect(beat).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    later(1_000);
    market.tick();
    expect(beat).toHaveBeenCalledTimes(2);
  });

  it("reports a failing handler for its plug-in and still runs everyone else's", async () => {
    const failing = market.forPlugin('failing');
    const fine = market.forPlugin('fine');
    const opened = vi.fn();
    failing.onOpen(() => { throw new Error('boom'); });
    failing.every(1_000, async () => { throw new Error('async boom'); });
    fine.onOpen(opened);
    market.start();
    await settle();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([['failing', 'boom'], ['failing', 'async boom']]);
  });

  it('drops every subscription of a plug-in it disposes, and one unsubscribed handler', () => {
    const plugin = market.forPlugin('p');
    const opened = vi.fn();
    const beat = vi.fn();
    const stopBeat = plugin.every(1_000, beat);
    plugin.onOpen(opened);
    stopBeat();
    market.start();
    expect(beat).not.toHaveBeenCalled();
    plugin.dispose();
    open = false;
    market.tick();
    open = true;
    market.tick();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('says whether the market is open now', () => {
    const plugin = market.forPlugin('p');
    expect(plugin.isOpen()).toBe(true);
    open = false;
    expect(plugin.isOpen()).toBe(false);
  });
});
