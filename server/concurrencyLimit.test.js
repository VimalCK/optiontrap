import { describe, it, expect } from 'vitest';
import { createConcurrencyLimit } from './concurrencyLimit.js';

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
