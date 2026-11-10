import { describe, it, expect } from 'vitest';
import { createConnectionCounter, MAX_CLIENT_MESSAGE_BYTES } from './wsLimits.js';

describe('createConnectionCounter', () => {
  it('refuses a user one connection beyond the maximum', () => {
    const counter = createConnectionCounter(3);
    expect([1, 2, 3, 4].map(() => counter.tryAcquire('AB1234'))).toEqual([true, true, true, false]);
  });

  it('counts each user separately', () => {
    const counter = createConnectionCounter(1);
    expect(counter.tryAcquire('AB1234')).toBe(true);
    expect(counter.tryAcquire('CD5678')).toBe(true);
  });

  it('allows a new connection once one is released', () => {
    const counter = createConnectionCounter(1);
    counter.tryAcquire('AB1234');
    counter.release('AB1234');
    expect(counter.count('AB1234')).toBe(0);
    expect(counter.tryAcquire('AB1234')).toBe(true);
  });

  it('never counts below zero', () => {
    const counter = createConnectionCounter(1);
    counter.release('AB1234');
    expect(counter.count('AB1234')).toBe(0);
  });
});

describe('MAX_CLIENT_MESSAGE_BYTES', () => {
  it('fits a subscribe for Kite\'s 3000-instrument maximum', () => {
    const tokens = Array.from({ length: 3000 }, (_, i) => 4294967295 - i);
    const message = JSON.stringify({ a: 'subscribe', v: tokens });
    expect(Buffer.byteLength(message)).toBeLessThan(MAX_CLIENT_MESSAGE_BYTES);
  });
});
