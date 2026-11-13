import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMarket, isAfterCloseOnWeekday } from './market.js';

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

describe('the market clock for scheduled jobs', () => {
  let now;
  let market;
  const HOUR = 60 * 60 * 1000;
  const NIGHTLY = 8 * 60 + 30; // 08:30 IST

  beforeEach(() => {
    market = createMarket({ clock: () => now, isOpen: () => false, setTimer: () => 'timer', clearTimer: () => {} });
  });

  /** Move the clock to `at` and read it, letting the handler before it finish. */
  const tickAt = async (at) => {
    await settle();
    now = at;
    market.tick();
  };

  it('runs a daily job from its time of day to midnight at its interval, then again the next day', async () => {
    const job = vi.fn();
    market.forPlugin('p').daily(NIGHTLY, HOUR, job);
    now = new Date('2026-11-12T01:30:00Z'); // Thu 07:00 IST
    market.start();
    expect(job).not.toHaveBeenCalled();
    await tickAt(new Date('2026-11-12T03:00:00Z')); // 08:30 IST
    expect(job).toHaveBeenCalledTimes(1);
    await tickAt(new Date('2026-11-12T03:59:00Z')); // 09:29 IST, inside the hour
    expect(job).toHaveBeenCalledTimes(1);
    await tickAt(new Date('2026-11-12T04:00:00Z')); // 09:30 IST
    expect(job).toHaveBeenCalledTimes(2);
    await tickAt(new Date('2026-11-12T18:31:00Z')); // Fri 00:01 IST: the window is shut
    await tickAt(new Date('2026-11-13T02:59:00Z')); // Fri 08:29 IST
    expect(job).toHaveBeenCalledTimes(2);
    await tickAt(new Date('2026-11-13T03:00:00Z')); // Fri 08:30 IST
    expect(job).toHaveBeenCalledTimes(3);
  });

  it('runs a daily job at once when the host starts after its time (a server down at 08:30)', () => {
    const job = vi.fn();
    market.forPlugin('p').daily(NIGHTLY, HOUR, job);
    now = new Date('2026-11-12T04:30:00Z'); // Thu 10:00 IST
    market.start();
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('runs an after-close job on weekdays from 15 minutes after the close, not at weekends', async () => {
    const job = vi.fn();
    market.forPlugin('p').afterClose(5 * 60 * 1000, job);
    now = new Date('2026-11-12T10:14:00Z'); // Thu 15:44 IST
    market.start();
    expect(job).not.toHaveBeenCalled();
    await tickAt(new Date('2026-11-12T10:15:00Z')); // Thu 15:45 IST
    expect(job).toHaveBeenCalledTimes(1);
    await tickAt(new Date('2026-11-14T10:30:00Z')); // Sat 16:00 IST
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('repeats a job at any time, first at once', async () => {
    const job = vi.fn();
    market.forPlugin('p').repeat(HOUR, job);
    now = new Date('2026-11-14T20:00:00Z'); // Sun 01:30 IST, market shut
    market.start();
    expect(job).toHaveBeenCalledTimes(1);
    await tickAt(new Date('2026-11-14T21:00:00Z'));
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a run still going with the next beat', async () => {
    let finish;
    const job = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    market.forPlugin('p').repeat(1_000, job);
    now = new Date('2026-11-14T20:00:00Z');
    market.start();
    await tickAt(new Date('2026-11-14T20:00:05Z'));
    expect(job).toHaveBeenCalledTimes(1);
    finish();
    await tickAt(new Date('2026-11-14T20:00:06Z'));
    expect(job).toHaveBeenCalledTimes(2);
  });
});

describe('isAfterCloseOnWeekday', () => {
  const utc = (iso) => new Date(`${iso}Z`);

  it('is due from 15:45 IST on weekdays', () => {
    expect(isAfterCloseOnWeekday(utc('2026-10-19T10:14:00'))).toBe(false); // Mon 15:44
    expect(isAfterCloseOnWeekday(utc('2026-10-19T10:15:00'))).toBe(true);  // Mon 15:45
    expect(isAfterCloseOnWeekday(utc('2026-10-23T18:29:00'))).toBe(true);  // Fri 23:59
  });

  it('is not due at weekends or before the close', () => {
    expect(isAfterCloseOnWeekday(utc('2026-10-24T11:00:00'))).toBe(false); // Sat 16:30
    expect(isAfterCloseOnWeekday(utc('2026-10-25T11:00:00'))).toBe(false); // Sun 16:30
    expect(isAfterCloseOnWeekday(utc('2026-10-20T04:00:00'))).toBe(false); // Tue 09:30
  });
});
