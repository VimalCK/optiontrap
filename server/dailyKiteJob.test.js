import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  status: null,
  claimed: true,
  finished: [],
}));

vi.mock('./db.js', () => ({
  getScheduledJobStatus: vi.fn(async () => db.status),
  claimScheduledJobRun: vi.fn(async () => db.claimed),
  finishScheduledJobRun: vi.fn(async (job, date, status, detail) => { db.finished.push({ job, date, status, detail }); }),
}));

const { createDailyKiteJob, isKiteLoginRefused } = await import('./dailyKiteJob.js');
const { getScheduledJobStatus } = await import('./db.js');

const KITE = { apiKey: 'key', accessToken: 'token', userId: 'ADMIN' };
const DATE = '2026-11-12';

/** A daily job with stub work; `work` pushes one result and returns the given outcome. */
function setup({ session = KITE, isReady, outcome = { loginRefused: false, summary: '3 rows' }, work } = {}) {
  const findSession = vi.fn(async () => session);
  const doWork = work ?? vi.fn(async ({ results }) => {
    results.push({ scrip: 'NIFTY', rowCount: 3 });
    return outcome;
  });
  return { run: createDailyKiteJob({ job: 'test-job', findSession, isReady, work: doWork }), findSession, work: doWork };
}

beforeEach(() => {
  Object.assign(db, { status: null, claimed: true, finished: [] });
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a daily Kite job', () => {
  it('runs the work once with the admin session and records it done with every result', async () => {
    const { run, work } = setup();
    await run(DATE);
    expect(work).toHaveBeenCalledWith(expect.objectContaining({ kite: KITE, date: DATE }));
    expect(db.finished).toEqual([{ job: 'test-job', date: DATE, status: 'Done', detail: { userId: 'ADMIN', results: [{ scrip: 'NIFTY', rowCount: 3 }] } }]);
  });

  it('remembers a done date, so later checks that day touch neither the database nor Kite', async () => {
    const { run, findSession } = setup();
    await run(DATE);
    await run(DATE);
    expect(getScheduledJobStatus).toHaveBeenCalledTimes(1);
    expect(findSession).toHaveBeenCalledTimes(1);
  });

  it('skips a date another server or an earlier start already finished', async () => {
    db.status = 'Done';
    const { run, work } = setup();
    await run(DATE);
    expect(work).not.toHaveBeenCalled();
  });

  it('waits while the job is not ready yet', async () => {
    const isReady = vi.fn(async () => false);
    const { run, work, findSession } = setup({ isReady });
    await run(DATE);
    expect(isReady).toHaveBeenCalledWith(DATE);
    expect(findSession).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('waits for an admin login, logging it once a day', async () => {
    const { run, work } = setup({ session: null });
    await run(DATE);
    await run(DATE);
    expect(work).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('leaves the date to the server that claimed it', async () => {
    db.claimed = false;
    const { run, work } = setup();
    await run(DATE);
    expect(work).not.toHaveBeenCalled();
    expect(db.finished).toEqual([]);
  });

  it('records a run Kite refused the login for as failed, and runs it again at the next check', async () => {
    const { run, work } = setup({ outcome: { loginRefused: true, summary: '0 rows' } });
    await run(DATE);
    expect(db.finished[0].status).toBe('Failed');
    db.status = 'Failed';
    await run(DATE);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('records a run whose work throws as failed, with the error and the results so far', async () => {
    const work = vi.fn(async ({ results }) => {
      results.push({ scrip: 'NIFTY', rowCount: 3 });
      throw new Error('db down');
    });
    const { run } = setup({ work });
    await run(DATE);
    expect(db.finished).toEqual([{ job: 'test-job', date: DATE, status: 'Failed', detail: { error: 'db down', results: [{ scrip: 'NIFTY', rowCount: 3 }] } }]);
  });
});

describe('isKiteLoginRefused', () => {
  it('is true for 401 and 403 only', () => {
    expect(isKiteLoginRefused({ status: 401 })).toBe(true);
    expect(isKiteLoginRefused({ status: 403 })).toBe(true);
    expect(isKiteLoginRefused({ status: 429 })).toBe(false);
    expect(isKiteLoginRefused(new Error('network'))).toBe(false);
  });
});
