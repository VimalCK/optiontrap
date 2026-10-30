import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KiteTicker, type Tick } from './kiteTicker';
import { handleKiteAuthFailure } from './authSession';
import { apiClient } from './apiClient';

/** One-packet binary message with the given int32 fields (prices in paise). */
function message(fields: number[]): ArrayBuffer {
  const length = fields.length * 4;
  const buffer = new ArrayBuffer(4 + length);
  const view = new DataView(buffer);
  view.setInt16(0, 1);
  view.setInt16(2, length);
  fields.forEach((value, i) => view.setInt32(4 + i * 4, value));
  return buffer;
}

const parse = (buffer: ArrayBuffer): Tick[] =>
  (new KiteTicker() as unknown as { parseBinary: (b: ArrayBuffer) => Tick[] }).parseBinary(buffer);

describe('KiteTicker packet parsing', () => {
  it('reads the previous close from a full-mode index packet', () => {
    // token, ltp, high, low, open, close, change, timestamp
    const [tick] = parse(message([256265, 2274775, 2280000, 2265000, 2270000, 2275320, -545, 0]));
    expect(tick.lastPrice).toBe(22747.75);
    expect(tick.closePrice).toBe(22753.2);
    expect(tick.openPrice).toBe(22700);
    expect(tick.oi).toBeUndefined();
  });

  it('reads the previous close from a quote-mode index packet', () => {
    const [tick] = parse(message([256265, 2274775, 2280000, 2265000, 2270000, 2275320, -545]));
    expect(tick.closePrice).toBe(22753.2);
  });

  it('still reads volume, close and OI from a full-mode option packet', () => {
    const fields = new Array(46).fill(0);
    fields[0] = 12345;
    fields[1] = 12050; // ltp 120.50
    fields[4] = 900;   // volume
    fields[10] = 11000; // close 110.00
    fields[12] = 750;  // oi
    const [tick] = parse(message(fields));
    expect(tick.lastPrice).toBe(120.5);
    expect(tick.volume).toBe(900);
    expect(tick.closePrice).toBe(110);
    expect(tick.oi).toBe(750);
  });
});

vi.mock('./authSession', () => ({ handleKiteAuthFailure: vi.fn() }));
vi.mock('./apiClient', () => ({ apiClient: { get: vi.fn(() => Promise.resolve()) } }));

/** Records the sockets the ticker opens so a test can close them with a given code. */
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor() { FakeSocket.last = this; }
  send() {}
  close() {}
}

describe('KiteTicker connection loss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } });
    vi.mocked(handleKiteAuthFailure).mockClear();
    vi.mocked(apiClient.get).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends the user to login and stops reconnecting when the Kite session expired', () => {
    const ticker = new KiteTicker();
    ticker.connect([256265], () => {});
    const first = FakeSocket.last;
    first!.onclose!({ code: 4001 });
    expect(handleKiteAuthFailure).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.last).toBe(first);
  });

  it('checks the session and keeps reconnecting after an abnormal close', () => {
    const ticker = new KiteTicker();
    ticker.connect([256265], () => {});
    const first = FakeSocket.last;
    first!.onclose!({ code: 1006 });
    expect(apiClient.get).toHaveBeenCalledWith('/auth/me');
    expect(handleKiteAuthFailure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.last).not.toBe(first);
    ticker.disconnect();
  });

  it('just reconnects after a normal close', () => {
    const ticker = new KiteTicker();
    ticker.connect([256265], () => {});
    FakeSocket.last!.onclose!({ code: 1000 });
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(handleKiteAuthFailure).not.toHaveBeenCalled();
    ticker.disconnect();
  });
});
