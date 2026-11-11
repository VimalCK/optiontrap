import { describe, it, expect } from 'vitest';
import { nightlyJobsHealth, tradeEngineHealth, tradeMonitorHealth, unreadableHealth } from './serviceHealth.js';

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const NOON_ISO = NOON.toISOString();

describe('tradeEngineHealth', () => {
  const run = (changes = {}) => ({ lastRun: { at: NOON.getTime(), users: 2, signals: 3, failed: 0, error: null, ...changes } });

  it('passes before the first run, with no time', () => {
    expect(tradeEngineHealth({ lastRun: null })).toEqual({ status: 'pass', output: 'No run yet · runs after each OI snapshot in market hours', time: null });
  });

  it('passes after a clean run, saying how many users and signals, at the run time', () => {
    expect(tradeEngineHealth(run())).toEqual({ status: 'pass', output: 'Last run · 2 users · 3 signals', time: NOON_ISO });
    expect(tradeEngineHealth(run({ users: 1, signals: 1 })).output).toBe('Last run · 1 user · 1 signal');
  });

  it('warns when some signals failed, and fails when the run failed', () => {
    expect(tradeEngineHealth(run({ failed: 1 }))).toEqual({ status: 'warn', output: 'Last run · 2 users · 3 signals · 1 failed', time: NOON_ISO });
    expect(tradeEngineHealth(run({ error: 'db down' }))).toEqual({ status: 'fail', output: 'Last run failed · db down', time: NOON_ISO });
  });
});

describe('tradeMonitorHealth', () => {
  const TICK = new Date('2026-11-05T06:29:30Z'); // Thu 11:59:30 IST
  const status = (changes = {}) => ({
    lastCheckAt: NOON.getTime(), marketOpen: true, feedConnected: true, waitingForLogin: false,
    watchedPositions: 2, watchedInstruments: 1, lastTickAt: TICK.getTime(), lastError: null, ...changes,
  });

  it('passes while watching, timed at the last tick', () => {
    expect(tradeMonitorHealth(status())).toEqual({ status: 'pass', output: 'Watching 2 positions in 1 instrument · last tick', time: TICK.toISOString() });
    expect(tradeMonitorHealth(status({ lastTickAt: null }))).toEqual({ status: 'pass', output: 'Watching 2 positions in 1 instrument · no tick yet', time: NOON_ISO });
  });

  it('passes when there is nothing to watch: before the first check, market closed, no open positions', () => {
    expect(tradeMonitorHealth(status({ lastCheckAt: null }))).toMatchObject({ status: 'pass', time: null });
    expect(tradeMonitorHealth(status({ marketOpen: false, feedConnected: false }))).toEqual({ status: 'pass', output: 'Market closed · watches automated positions in market hours', time: NOON_ISO });
    expect(tradeMonitorHealth(status({ feedConnected: false, watchedPositions: 0 }))).toEqual({ status: 'pass', output: 'No open automated positions', time: NOON_ISO });
  });

  it('fails when positions go unwatched for want of an admin login, or the market check failed', () => {
    expect(tradeMonitorHealth(status({ feedConnected: false, waitingForLogin: true, watchedPositions: 1 })))
      .toEqual({ status: 'fail', output: '1 open position unwatched · no admin Kite login', time: NOON_ISO });
    expect(tradeMonitorHealth(status({ lastError: 'db down' }))).toEqual({ status: 'fail', output: 'Market check failed · db down', time: NOON_ISO });
  });
});

describe('nightlyJobsHealth', () => {
  const job = (file, status, error = null) => ({ file, status, error });
  const status = (jobs) => ({ date: '2026-11-11', jobs });

  it('passes when every job is done, or some are still running', () => {
    expect(nightlyJobsHealth(status([job('010_a.sql', 'done'), job('020_b.js', 'done')])))
      .toEqual({ status: 'pass', output: 'All 2 jobs done for 11 Nov', time: null });
    expect(nightlyJobsHealth(status([job('010_a.sql', 'done'), job('020_b.js', 'running')])))
      .toEqual({ status: 'pass', output: 'Running for 11 Nov · 1 of 2 done', time: null });
    expect(nightlyJobsHealth(status([])).status).toBe('pass');
  });

  it('warns when some jobs have not run, and fails with the first failure', () => {
    expect(nightlyJobsHealth(status([job('010_a.sql', 'done'), job('020_b.js', null)])))
      .toEqual({ status: 'warn', output: '1 of 2 not run for 11 Nov', time: null });
    expect(nightlyJobsHealth(status([job('010_a.sql', 'failed', 'timeout'), job('020_b.js', 'done')])))
      .toEqual({ status: 'fail', output: '1 of 2 failed for 11 Nov · 010_a.sql: timeout', time: null });
  });
});

describe('unreadableHealth', () => {
  it('fails with why the status could not be read', () => {
    expect(unreadableHealth('job runs', new Error('db down'))).toEqual({ status: 'fail', output: "Couldn't read the job runs · db down", time: null });
  });
});
