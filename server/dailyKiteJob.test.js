import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  /** Each job's run status for the date, by job name; missing means no run yet. */
  statuses: {},
  claimed: true,
  finished: [],
}));

vi.mock('./db.js', () => ({
  getScheduledJobStatus: vi.fn(async (job) => db.statuses[job] ?? null),
  claimScheduledJobRun: vi.fn(async () => db.claimed),
  finishScheduledJobRun: vi.fn(async (job, date, status, detail) => { db.finished.push({ job, date, status, detail }); }),
}));

const { createDailyKiteJob } = await import('./dailyKiteJob.js');
const { getScheduledJobStatus } = await import('./db.js');

const KITE = { apiKey: 'key', accessToken: 'token', userId: 'ADMIN' };
const DATE = '2026-11-12';

/** A daily job with stub work; `work` pushes one result and returns the given outcome. */
function setup({ session = KITE, dependsOn, outcome = { loginRefused: false, summary: '3 rows' }, work } = {}) {
  const findSession = vi.fn(async () => session);
  const doWork = work ?? vi.fn(async ({ results }) => {
    results.push({ scrip: 'NIFTY', rowCount: 3 });
    return outcome;
  });
  return { run: createDailyKiteJob({ job: 'test-job', findSession, dependsOn, work: doWork }), findSession, work: doWork };
}

beforeEach(() => {
  Object.assign(db, { statuses: {}, claimed: true, finished: [] });
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
    db.statuses['test-job'] = 'Done';
    const { run, work } = setup();
    await run(DATE);
    expect(work).not.toHaveBeenCalled();
  });

  it('waits until the job it depends on has a run for the date that is no longer running', async () => {
    const { run, work, findSession } = setup({ dependsOn: 'first-job' });
    await run(DATE); // no run yet
    db.statuses['first-job'] = 'Running';
    await run(DATE);
    expect(findSession).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(getScheduledJobStatus).toHaveBeenCalledWith('first-job', DATE);
  });

  it('runs once the job it depends on is done, or failed (it may not retry today)', async () => {
    for (const status of ['Done', 'Failed']) {
      const { run, work } = setup({ dependsOn: 'first-job' });
      db.statuses = { 'first-job': status };
      await run(DATE);
      expect(work).toHaveBeenCalledTimes(1);
    }
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
    db.statuses['test-job'] = 'Failed';
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
