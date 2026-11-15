import { describe, it, expect } from 'vitest';
import { createConcurrencyLimit, forEachLimited } from './concurrencyLimit.js';

describe('createConcurrencyLimit', () => {
  it('refuses a key one beyond the maximum', () => {
    const limit = createConcurrencyLimit(3);
    expect([1, 2, 3, 4].map(() => limit.tryAcquire('AB1234'))).toEqual([true, true, true, false]);
  });

  it('counts each key separately', () => {
    const limit = createConcurrencyLimit(1);
    expect(limit.tryAcquire('AB1234')).toBe(true);
    expect(limit.tryAcquire('CD5678')).toBe(true);
  });

  it('allows another once one is released', () => {
    const limit = createConcurrencyLimit(1);
    limit.tryAcquire('AB1234');
    limit.release('AB1234');
    expect(limit.count('AB1234')).toBe(0);
    expect(limit.tryAcquire('AB1234')).toBe(true);
  });

  it('never counts below zero', () => {
    const limit = createConcurrencyLimit(1);
    limit.release('AB1234');
    expect(limit.count('AB1234')).toBe(0);
  });
});

describe('forEachLimited', () => {
  const gate = () => {
    let open;
    const opened = new Promise((resolve) => { open = resolve; });
    return { opened, open };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('runs every item, starting the next only when one finishes', async () => {
    const gates = [0, 1, 2, 3, 4].map(gate);
    const started = [];
    const run = forEachLimited([0, 1, 2, 3, 4], 2, async (i) => { started.push(i); await gates[i].opened; });
    await settle();
    expect(started).toEqual([0, 1]);
    gates[1].open();
    await settle();
    expect(started).toEqual([0, 1, 2]);
    gates.forEach((g) => g.open());
    await run;
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('does nothing for no items', async () => {
    let calls = 0;
    await forEachLimited([], 3, async () => { calls += 1; });
    expect(calls).toBe(0);
  });
});
