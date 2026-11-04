import { describe, it, expect } from 'vitest';
import { buildPositionsQuery, isValidPositionStatus } from './positionsQuery.js';

const todayStart = '2026-11-03T18:30:00.000Z'; // 4 Nov 2026, 00:00 IST

describe('buildPositionsQuery', () => {
  it('by default returns open positions plus those exited today, newest entry first', () => {
    expect(buildPositionsQuery('U1', { mode: 'paper', todayStart })).toEqual({
      sql: 'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 AND (exited = 0 OR exit_time >= $3) ORDER BY entry_time DESC',
      params: ['U1', 'paper', todayStart],
    });
  });

  it('numbers the today filter $2 when no mode is given', () => {
    expect(buildPositionsQuery('U1', { todayStart })).toEqual({
      sql: 'SELECT * FROM positions WHERE user_id = $1 AND (exited = 0 OR exit_time >= $2) ORDER BY entry_time DESC',
      params: ['U1', todayStart],
    });
  });

  it('with status=closed returns every exit from any day, latest exit first', () => {
    expect(buildPositionsQuery('U1', { mode: 'paper', status: 'closed', todayStart })).toEqual({
      sql: 'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 AND exited = 1 ORDER BY exit_time DESC',
      params: ['U1', 'paper'],
    });
  });

  it('with status=closed and no mode covers both paper and live', () => {
    expect(buildPositionsQuery('U1', { status: 'closed', todayStart })).toEqual({
      sql: 'SELECT * FROM positions WHERE user_id = $1 AND exited = 1 ORDER BY exit_time DESC',
      params: ['U1'],
    });
  });

  it('passes user input only as parameters, never in the SQL text', () => {
    const { sql, params } = buildPositionsQuery("U1'; DROP TABLE positions;--", { mode: "paper' OR 1=1", todayStart });
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('OR 1=1');
    expect(params).toContain("paper' OR 1=1");
  });
});

describe('isValidPositionStatus', () => {
  it('accepts closed or no status', () => {
    expect(isValidPositionStatus('closed')).toBe(true);
    expect(isValidPositionStatus(undefined)).toBe(true);
  });

  it.each([['open'], ['all'], [''], ['CLOSED'], [['closed', 'closed']]])('rejects %j', (status) => {
    expect(isValidPositionStatus(status)).toBe(false);
  });
});
