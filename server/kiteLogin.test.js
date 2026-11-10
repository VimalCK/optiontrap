import { describe, it, expect } from 'vitest';
import { kiteLoginUrl } from './kiteLogin.js';

describe('kiteLoginUrl', () => {
  it('builds the Kite Connect v3 login URL for a plain key', () => {
    expect(kiteLoginUrl('abc123xyz')).toEqual({ url: 'https://kite.zerodha.com/connect/login?v=3&api_key=abc123xyz' });
  });

  it("encodes the key so it can't add parameters to Kite's URL", () => {
    const { url } = kiteLoginUrl('abc&redirect_params=x=1#frag');
    const params = new URL(url).searchParams;
    expect([...params.keys()]).toEqual(['v', 'api_key']);
    expect(params.get('api_key')).toBe('abc&redirect_params=x=1#frag');
    expect(new URL(url).hash).toBe('');
  });

  it('refuses a missing, empty or repeated key', () => {
    const error = 'api_key query parameter is required';
    expect(kiteLoginUrl(undefined)).toEqual({ error });
    expect(kiteLoginUrl('')).toEqual({ error });
    expect(kiteLoginUrl(['a', 'b'])).toEqual({ error });
  });
});
