import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectJobFiles } from './nightlyJobs.js';
import { isNightlyJobTime } from './marketClock.js';

// Fake scheduled_job_runs: job -> date -> status. Hoisted so the db.js mock can use it.
const runs = vi.hoisted(() => new Map());

vi.mock('./db.js', () => ({
  getScheduledJobStatus: async (job, date) => runs.get(job)?.get(date) ?? null,
  claimScheduledJobRun: async (job, date) => {
    if (!runs.has(job)) runs.set(job, new Map());
    runs.get(job).set(date, 'running');
    return true;
  },
  finishScheduledJobRun: async (job, date, status) => { runs.get(job).set(date, status); },
  runSqlScript: async () => 0,
  query: async () => ({ rowCount: 0 }),
}));

// IST is UTC+05:30, so 03:00 UTC is 08:30 IST.
const utc = (iso) => new Date(`${iso}Z`);
const ist = (hhmm, date) => new Date(`${date}T${hhmm}:00+05:30`);

describe('isNightlyJobTime', () => {
  it('is due from 08:30 IST until midnight, every day', () => {
    expect(isNightlyJobTime(utc('2026-10-19T02:59:00'))).toBe(false); // Mon 08:29
    expect(isNightlyJobTime(utc('2026-10-19T03:00:00'))).toBe(true);  // Mon 08:30
    expect(isNightlyJobTime(utc('2026-10-24T18:29:00'))).toBe(true);  // Sat 23:59
  });

  it('is not due between midnight and 08:30 IST', () => {
    expect(isNightlyJobTime(utc('2026-10-19T18:30:00'))).toBe(false); // Tue 00:00
    expect(isNightlyJobTime(utc('2026-10-20T02:00:00'))).toBe(false); // Tue 07:30
  });
});

describe('startNightlyJobs', () => {
  let startNightlyJobs;

  beforeEach(async () => {
    runs.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules(); // fresh runner state per test
    ({ startNightlyJobs } = await import('./nightlyJobs.js'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Dates each job ran (finished) for. */
  const ranDates = () => [...runs.values()].map((byDate) => [...byDate.keys()].filter((d) => byDate.get(d) === 'done'));

  it('runs at once when the server starts after a missed 08:30, then not again that day', async () => {
    // Server was down 07:00-10:00 and is started at 10:00.
    vi.useFakeTimers({ now: ist('10:00', '2026-11-04') });
    startNightlyJobs();
    await vi.advanceTimersByTimeAsync(0);

    expect(runs.size).toBeGreaterThan(0);
    expect(ranDates().every((dates) => dates.length === 1 && dates[0] === '2026-11-04')).toBe(true);

    // Hourly checks for the rest of the day find the runs done.
    const finished = [...runs.values()].map((byDate) => byDate.size);
    await vi.advanceTimersByTimeAsync(13 * 60 * 60 * 1000); // to 23:00
    expect([...runs.values()].map((byDate) => byDate.size)).toEqual(finished);
  });

  it('waits for 08:30 when the server starts before it', async () => {
    vi.useFakeTimers({ now: ist('06:30', '2026-11-04') });
    startNightlyJobs();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.size).toBe(0);

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000); // 08:30 check
    expect(runs.size).toBeGreaterThan(0);
    expect(ranDates().flat().every((d) => d === '2026-11-04')).toBe(true);
  });
});

describe('selectJobFiles', () => {
  it('keeps .sql and .js jobs in filename order', () => {
    expect(selectJobFiles(['020_b.js', '010_a.sql', '030_c.sql'])).toEqual(['010_a.sql', '020_b.js', '030_c.sql']);
  });

  it('skips paused, hidden, test and other files', () => {
    expect(selectJobFiles(['_010_paused.sql', '.hidden.js', '020_x.test.js', 'README.md', '030_ok.sql'])).toEqual(['030_ok.sql']);
  });
});
