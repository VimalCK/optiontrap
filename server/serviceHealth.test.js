import { describe, it, expect } from 'vitest';
import { countLabel, healthTime, nightlyJobsHealth, tradeEngineHealth, unreadableHealth } from './serviceHealth.js';

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const NOON_ISO = NOON.toISOString();

describe('tradeEngineHealth', () => {
  const pass = (output, time = null) => ({ status: 'Pass', output, time });
  const plugin = (id, health = null, changes = {}) => ({ id, kind: 'Service', state: 'Running', error: null, health, ...changes });
  const engine = (...plugins) => ({ running: true, plugins });

  it("passes when every plug-in passes, joining their own outputs in order, timed at the first that has a time", () => {
    expect(tradeEngineHealth(engine(plugin('orders'), plugin('a', pass('Last run · 2 users', NOON_ISO)), plugin('b', pass('Market closed')))))
      .toEqual({ status: 'Pass', output: 'Last run · 2 users · Market closed', time: NOON_ISO });
  });

  it('passes with a plain output when no plug-in reports its own health', () => {
    expect(tradeEngineHealth(engine(plugin('orders')))).toEqual({ status: 'Pass', output: 'All plug-ins running', time: null });
  });

  it('warns while standing by for the engine lock', () => {
    expect(tradeEngineHealth({ running: false, plugins: [] })).toEqual({ status: 'Warn', output: 'Standing by · not holding the engine lock', time: null });
  });

  it('fails when a plug-in could not start', () => {
    const failedStart = plugin('option-analyzer-setups', null, { kind: 'Strategy', state: 'Failed', error: 'boom' });
    expect(tradeEngineHealth(engine(plugin('a', pass('ok')), failedStart))).toEqual({ status: 'Fail', output: 'option-analyzer-setups could not start · boom', time: null });
  });

  it("reports a plug-in's own failing check as the engine's, before a handler error", () => {
    const failing = { status: 'Fail', output: 'Trade monitor · Loading positions failed · db down', time: null };
    const erred = plugin('setups', null, { error: 'timeout' });
    expect(tradeEngineHealth(engine(erred, plugin('monitor', failing)))).toEqual(failing);
  });

  it("warns for a handler that failed, before a plug-in's own warning", () => {
    const warning = { status: 'Warn', output: 'Last run · 2 users · 3 signals · 1 failed', time: NOON_ISO };
    expect(tradeEngineHealth(engine(plugin('signals', warning), plugin('setups', null, { error: 'db down' }))))
      .toEqual({ status: 'Warn', output: 'setups failed · db down', time: null });
    expect(tradeEngineHealth(engine(plugin('signals', warning)))).toEqual(warning);
  });
});

describe('check helpers', () => {
  it('count with a singular or plural noun, and time a check in ISO', () => {
    expect(countLabel(1, 'user')).toBe('1 user');
    expect(countLabel(2, 'user')).toBe('2 users');
    expect(healthTime(NOON.getTime())).toBe(NOON_ISO);
    expect(healthTime(null)).toBeNull();
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
