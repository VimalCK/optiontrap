import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({ fresh: false, admin: null, syncs: [] }));

vi.mock('./instruments.js', () => ({
  instrumentsAreFresh: async () => state.fresh,
  getOrFetchInstruments: async (apiKey) => { state.syncs.push(apiKey); state.fresh = true; return []; },
}));
vi.mock('./oiHistoryScheduler.js', () => ({ findWorkingAdminSession: async () => state.admin }));

const ADMIN = { apiKey: 'admin-key', accessToken: 'token' };
const ist = (hhmm) => new Date(`2026-11-04T${hhmm}:00+05:30`);
let startInstrumentSync;

beforeEach(async () => {
  Object.assign(state, { fresh: false, admin: null, syncs: [] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.resetModules();
  ({ startInstrumentSync } = await import('./instrumentSyncScheduler.js'));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start(hhmm) {
  vi.useFakeTimers({ now: ist(hhmm) });
  startInstrumentSync();
  await vi.advanceTimersByTimeAsync(0);
}

describe('startInstrumentSync', () => {
  it('syncs at startup with the admin session when the stored list is out of date', async () => {
    state.admin = ADMIN;
    await start('10:00'); // e.g. the server was down at 08:30
    expect(state.syncs).toEqual(['admin-key']);
  });

  it('does nothing while the stored list is current', async () => {
    state.admin = ADMIN;
    state.fresh = true;
    await start('10:00');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(state.syncs).toEqual([]);
  });

  it('waits for an admin login, then syncs at the next check', async () => {
    await start('08:30');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(state.syncs).toEqual([]);

    state.admin = ADMIN; // admin logs in at 08:42
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(state.syncs).toEqual(['admin-key']);
  });

  it('syncs once, not at every later check', async () => {
    state.admin = ADMIN;
    await start('08:30');
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(state.syncs).toHaveLength(1);
  });
});
