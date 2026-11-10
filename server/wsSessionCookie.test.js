import { describe, it, expect } from 'vitest';
import signature from 'cookie-signature';
import { signedSessionId } from './wsSessionCookie.js';

const SECRET = 'test-secret';
const NAME = 'optiontrap_sid';
/** A cookie as express-session writes it: `s:` + signed ID, URI-encoded. */
const sessionCookie = (sid, secret = SECRET) => `${NAME}=${encodeURIComponent(`s:${signature.sign(sid, secret)}`)}`;

describe('signedSessionId', () => {
  it('reads the session ID from a correctly signed cookie among others', () => {
    expect(signedSessionId(`theme=dark; ${sessionCookie('abc123')}; lang=en`, NAME, SECRET)).toBe('abc123');
  });

  it('returns null, without throwing, for a malformed escape that used to stop the server', () => {
    expect(() => signedSessionId(`${NAME}=%E0`, NAME, SECRET)).not.toThrow();
    expect(signedSessionId(`${NAME}=%E0`, NAME, SECRET)).toBeNull();
  });

  it('refuses a missing, unsigned or wrongly signed cookie', () => {
    expect(signedSessionId(undefined, NAME, SECRET)).toBeNull();
    expect(signedSessionId('theme=dark', NAME, SECRET)).toBeNull();
    expect(signedSessionId(`${NAME}=abc123`, NAME, SECRET)).toBeNull();
    expect(signedSessionId(sessionCookie('abc123', 'other-secret'), NAME, SECRET)).toBeNull();
  });
});
