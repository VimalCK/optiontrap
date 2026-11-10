import { describe, it, expect } from 'vitest';
import { createKeyedQueue, createSharedRuns } from './sharedRuns.js';

/** A promise with its resolve/reject exposed, to control when work finishes. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createSharedRuns', () => {
  it('runs the work once for callers that ask at the same time', async () => {
    const runs = createSharedRuns();
    const done = deferred();
    let calls = 0;
    const work = () => { calls += 1; return done.promise; };

    const first = runs.join('k', work);
    const second = runs.join('k', work);
    done.resolve('rows');

    expect([first.started, second.started]).toEqual([true, false]);
    expect(await Promise.all([first.result, second.result])).toEqual(['rows', 'rows']);
    expect(calls).toBe(1);
  });

  it('sends the run\'s progress to every caller that joined', async () => {
    const runs = createSharedRuns();
    const done = deferred();
    let emitProgress;
    const seen = { a: [], b: [] };
    const work = ({ emit }) => { emitProgress = emit; return done.promise; };

    const a = runs.join('k', work, { onEvent: (event) => seen.a.push(event) });
    const b = runs.join('k', work, { onEvent: (event) => seen.b.push(event) });
    await Promise.resolve();
    emitProgress('progress', {});
    done.resolve();
    await Promise.all([a.result, b.result]);

    expect(seen).toEqual({ a: ['progress'], b: ['progress'] });
  });

  it('starts a new run once the previous one has finished', async () => {
    const runs = createSharedRuns();
    let calls = 0;
    const work = async () => { calls += 1; return calls; };

    expect(await runs.join('k', work).result).toBe(1);
    expect(await runs.join('k', work).result).toBe(2);
  });

  it('runs different keys separately', async () => {
    const runs = createSharedRuns();
    const a = runs.join('a', async () => 'A');
    const b = runs.join('b', async () => 'B');
    expect([a.started, b.started]).toEqual([true, true]);
    expect(await Promise.all([a.result, b.result])).toEqual(['A', 'B']);
  });

  it('gives every caller the run\'s failure', async () => {
    const runs = createSharedRuns();
    const done = deferred();
    const work = () => done.promise;
    const a = runs.join('k', work);
    const b = runs.join('k', work);
    done.reject(new Error('Kite down'));

    await expect(a.result).rejects.toThrow('Kite down');
    await expect(b.result).rejects.toThrow('Kite down');
  });

  it('keeps the run going while another caller still waits for it', async () => {
    const runs = createSharedRuns();
    const done = deferred();
    let runSignal;
    const work = ({ signal }) => { runSignal = signal; return done.promise; };
    const leaving = new AbortController();

    const a = runs.join('k', work, { signal: leaving.signal });
    const b = runs.join('k', work);
    await Promise.resolve();
    leaving.abort();
    done.resolve('rows');

    await expect(a.result).rejects.toBeDefined();
    expect(await b.result).toBe('rows');
    expect(runSignal.aborted).toBe(false);
  });

  it('cancels the run when its last caller leaves, and starts afresh for the next', async () => {
    const runs = createSharedRuns();
    let runSignal;
    const work = ({ signal }) => { runSignal = signal; return new Promise(() => {}); };
    const leaving = new AbortController();

    const a = runs.join('k', work, { signal: leaving.signal });
    await Promise.resolve();
    leaving.abort();

    await expect(a.result).rejects.toBeDefined();
    expect(runSignal.aborted).toBe(true);
    expect(runs.isRunning('k')).toBe(false);
    expect(runs.join('k', async () => 'fresh').started).toBe(true);
  });

  it('refuses a caller whose signal is already cancelled', () => {
    const runs = createSharedRuns();
    const cancelled = AbortSignal.abort();
    expect(() => runs.join('k', async () => 'x', { signal: cancelled })).toThrow();
    expect(runs.isRunning('k')).toBe(false);
  });
});

describe('createKeyedQueue', () => {
  it('runs work for the same key one after another', async () => {
    const queue = createKeyedQueue();
    const first = deferred();
    const order = [];

    const a = queue.run('k', async () => { order.push('a start'); await first.promise; order.push('a end'); });
    const b = queue.run('k', async () => { order.push('b start'); });
    await Promise.resolve();
    expect(order).toEqual(['a start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a start', 'a end', 'b start']);
  });

  it('runs the next work even when the previous one failed', async () => {
    const queue = createKeyedQueue();
    const a = queue.run('k', async () => { throw new Error('failed'); });
    const b = queue.run('k', async () => 'ran');
    await expect(a).rejects.toThrow('failed');
    expect(await b).toBe('ran');
  });

  it('runs different keys at the same time', async () => {
    const queue = createKeyedQueue();
    const blocked = deferred();
    queue.run('a', () => blocked.promise);
    expect(await queue.run('b', async () => 'b ran')).toBe('b ran');
    blocked.resolve();
  });
});
