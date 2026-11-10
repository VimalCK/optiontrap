import { describe, it, expect } from 'vitest';
import { DEV_SESSION_SECRET, resolveSessionSecret } from './sessionSecret.js';

describe('resolveSessionSecret', () => {
  it('uses the configured secret in production', () => {
    expect(resolveSessionSecret({ secret: 'a-private-value', isProd: true })).toEqual({ value: 'a-private-value' });
  });

  it('refuses production without a secret', () => {
    expect(resolveSessionSecret({ secret: undefined, isProd: true }).error).toMatch(/SESSION_SECRET/);
    expect(resolveSessionSecret({ secret: '', isProd: true }).error).toMatch(/SESSION_SECRET/);
  });

  it('refuses production set to the public dev value', () => {
    expect(resolveSessionSecret({ secret: DEV_SESSION_SECRET, isProd: true }).error).toMatch(/SESSION_SECRET/);
  });

  it('falls back to the dev value outside production', () => {
    expect(resolveSessionSecret({ secret: undefined, isProd: false })).toEqual({ value: DEV_SESSION_SECRET });
    expect(resolveSessionSecret({ secret: 'mine', isProd: false })).toEqual({ value: 'mine' });
  });
});
