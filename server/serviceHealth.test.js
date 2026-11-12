import { describe, it, expect } from 'vitest';
import { nightlyJobsHealth, tradeEngineHealth, tradeMonitorHealth, unreadableHealth } from './serviceHealth.js';

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const NOON_ISO = NOON.toISOString();

describe('tradeEngineHealth', () => {
  const plugin = (id, changes = {}) => ({ id, kind: 'service', state: 'Running', error: null, ...changes });
  const monitor = (changes = {}) => plugin('tradeMonitor', {
    marketOpen: false, feedConnected: false, waitingForLogin: false, watchedPositions: 0, watchedInstruments: 0, lastTickAt: null, lastError: null, ...changes,
  });
  const engine = (lastRun, plugins = [], monitorChanges = {}) => ({
    running: true, plugins: [plugin('orders'), plugin('signals', { lastRun }), monitor(monitorChanges), ...plugins],
  });
  const run = (changes = {}) => engine({ at: NOON.getTime(), users: 2, signals: 3, failed: 0, error: null, ...changes });
  const CLOSED = 'Market closed · watches automated positions in market hours';

  it('passes before the first run, with no time, saying what the monitor is doing', () => {
    expect(tradeEngineHealth(engine(null))).toEqual({ status: 'Pass', output: `No run yet · runs when a strategy has a new signal · ${CLOSED}`, time: null });
  });

  it("reports the trade monitor's problem as the engine's", () => {
    expect(tradeEngineHealth(engine(null, [], { marketOpen: true, waitingForLogin: true, watchedPositions: 1 })))
      .toEqual({ status: 'Fail', output: 'Trade monitor · 1 open position unwatched · no admin Kite login', time: null });
    expect(tradeEngineHealth(engine(null, [], { lastError: 'db down' })))
      .toEqual({ status: 'Fail', output: 'Trade monitor · Loading positions failed · db down', time: null });
  });

  it('warns while standing by for the engine lock', () => {
    expect(tradeEngineHealth({ running: false, plugins: [] })).toEqual({ status: 'Warn', output: 'Standing by · not holding the engine lock', time: null });
  });

  it('fails when a plug-in could not start, and warns when a running one failed', () => {
    const failedStart = plugin('option-analyzer-setups', { kind: 'strategy', state: 'Failed', error: 'boom' });
    expect(tradeEngineHealth(engine(null, [failedStart]))).toEqual({ status: 'Fail', output: 'option-analyzer-setups could not start · boom', time: null });
    const erred = plugin('option-analyzer-setups', { kind: 'strategy', error: 'db down' });
    expect(tradeEngineHealth(engine(null, [erred]))).toEqual({ status: 'Warn', output: 'option-analyzer-setups failed · db down', time: null });
  });

  it('passes after a clean run, saying how many users and signals, at the run time', () => {
    expect(tradeEngineHealth(run())).toEqual({ status: 'Pass', output: `Last run · 2 users · 3 signals · ${CLOSED}`, time: NOON_ISO });
    expect(tradeEngineHealth(run({ users: 1, signals: 1 })).output).toBe(`Last run · 1 user · 1 signal · ${CLOSED}`);
  });

  it('warns when some signals failed, and fails when the run failed', () => {
    expect(tradeEngineHealth(run({ failed: 1 }))).toEqual({ status: 'Warn', output: 'Last run · 2 users · 3 signals · 1 failed', time: NOON_ISO });
    expect(tradeEngineHealth(run({ error: 'db down' }))).toEqual({ status: 'Fail', output: 'Last run failed · db down', time: NOON_ISO });
  });
});

describe('tradeMonitorHealth', () => {
  const TICK = new Date('2026-11-05T06:29:30Z'); // Thu 11:59:30 IST
  const status = (changes = {}) => ({
    id: 'tradeMonitor', kind: 'service', state: 'Running', error: null,
    marketOpen: true, feedConnected: true, waitingForLogin: false,
    watchedPositions: 2, watchedInstruments: 1, lastTickAt: TICK.getTime(), lastError: null, ...changes,
  });

  it('passes while watching, timed at the last tick', () => {
    expect(tradeMonitorHealth(status())).toEqual({ status: 'Pass', output: 'Watching 2 positions in 1 instrument · last tick', time: TICK.toISOString() });
    expect(tradeMonitorHealth(status({ lastTickAt: null }))).toEqual({ status: 'Pass', output: 'Watching 2 positions in 1 instrument · no tick yet', time: null });
  });

  it('passes when there is nothing to watch: market closed, no open positions', () => {
    expect(tradeMonitorHealth(status({ marketOpen: false, feedConnected: false }))).toEqual({ status: 'Pass', output: 'Market closed · watches automated positions in market hours', time: null });
    expect(tradeMonitorHealth(status({ feedConnected: false, watchedPositions: 0 }))).toEqual({ status: 'Pass', output: 'No open automated positions', time: null });
  });

  it('fails when positions go unwatched for want of an admin login, or loading them failed', () => {
    expect(tradeMonitorHealth(status({ feedConnected: false, waitingForLogin: true, watchedPositions: 1 })))
      .toEqual({ status: 'Fail', output: '1 open position unwatched · no admin Kite login', time: null });
    expect(tradeMonitorHealth(status({ lastError: 'db down' }))).toEqual({ status: 'Fail', output: 'Loading positions failed · db down', time: null });
  });

  it('fails when the monitor is not running, with why', () => {
    expect(tradeMonitorHealth(undefined)).toEqual({ status: 'Fail', output: 'Not running', time: null });
    expect(tradeMonitorHealth({ id: 'tradeMonitor', kind: 'service', state: 'Failed', error: 'boom' })).toEqual({ status: 'Fail', output: 'Not running · boom', time: null });
  });
});

describe('nightlyJobsHealth', () => {
  const job = (file, status, error = null) => ({ file, status, error });
  const status = (jobs) => ({ date: '2026-11-11', jobs });

  it('passes when every job is done, or some are still running', () => {
    expect(nightlyJobsHealth(status([job('010_a.sql', 'Done'), job('020_b.js', 'Done')])))
      .toEqual({ status: 'Pass', output: 'All 2 jobs done for 11 Nov', time: null });
    expect(nightlyJobsHealth(status([job('010_a.sql', 'Done'), job('020_b.js', 'Running')])))
      .toEqual({ status: 'Pass', output: 'Running for 11 Nov · 1 of 2 done', time: null });
    expect(nightlyJobsHealth(status([])).status).toBe('Pass');
  });

  it('warns when some jobs have not run, and fails with the first failure', () => {
    expect(nightlyJobsHealth(status([job('010_a.sql', 'Done'), job('020_b.js', null)])))
      .toEqual({ status: 'Warn', output: '1 of 2 not run for 11 Nov', time: null });
    expect(nightlyJobsHealth(status([job('010_a.sql', 'Failed', 'timeout'), job('020_b.js', 'Done')])))
      .toEqual({ status: 'Fail', output: '1 of 2 failed for 11 Nov · 010_a.sql: timeout', time: null });
  });
});

describe('unreadableHealth', () => {
  it('fails with why the status could not be read', () => {
    expect(unreadableHealth('job runs', new Error('db down'))).toEqual({ status: 'Fail', output: "Couldn't read the job runs · db down", time: null });
  });
});
