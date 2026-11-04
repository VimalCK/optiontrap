import { describe, it, expect } from 'vitest';
import {
  MARKET_CLOSED_MESSAGE,
  buildDailyPnlQuery,
  buildPositionsQuery,
  buildStatsQueries,
  paperTradeClosedReason,
  parseDailyPnlQuery,
  parsePositionsQuery,
  parseStatsQuery,
} from './positionsQuery.js';

/** The instant at `hhmm` IST on `date` (IST is UTC+5:30). */
const ist = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((h * 60 + m) - 330) * 60000);
};

describe('paperTradeClosedReason', () => {
  const TRADING_DAY = '2026-11-05'; // Thursday

  it.each([
    ['at the open, 9:15', '09:15'],
    ['mid-session', '12:00'],
    ['at the close, 15:30', '15:30'],
  ])('allows a paper trade %s', (_label, time) => {
    expect(paperTradeClosedReason('paper', ist(TRADING_DAY, time))).toBeNull();
  });

  it.each([
    ['in pre-open, 9:14', '09:14'],
    ['before pre-open, 8:00', '08:00'],
    ['just after the close, 15:31', '15:31'],
    ['in the evening', '20:00'],
    ['after midnight', '00:30'],
  ])('blocks a paper trade %s', (_label, time) => {
    expect(paperTradeClosedReason('paper', ist(TRADING_DAY, time))).toBe(MARKET_CLOSED_MESSAGE);
  });

  it('blocks paper trades all weekend, even in session hours', () => {
    expect(paperTradeClosedReason('paper', ist('2026-10-17', '11:00'))).toBe(MARKET_CLOSED_MESSAGE); // Saturday
    expect(paperTradeClosedReason('paper', ist('2026-10-18', '11:00'))).toBe(MARKET_CLOSED_MESSAGE); // Sunday
  });

  it('blocks paper trades on a weekday market holiday', () => {
    expect(paperTradeClosedReason('paper', ist('2026-01-26', '11:00'))).toBe(MARKET_CLOSED_MESSAGE); // Republic Day, Monday
  });

  it('judges the time in IST, not the server’s zone', () => {
    // 05:00 UTC on a Thursday is 10:30 IST: open, though early morning in Europe.
    expect(paperTradeClosedReason('paper', new Date('2026-11-05T05:00:00Z'))).toBeNull();
    // 23:00 UTC on Thursday is 04:30 IST on Friday: closed.
    expect(paperTradeClosedReason('paper', new Date('2026-11-05T23:00:00Z'))).toBe(MARKET_CLOSED_MESSAGE);
  });

  it('treats a missing mode as paper', () => {
    expect(paperTradeClosedReason(undefined, ist(TRADING_DAY, '20:00'))).toBe(MARKET_CLOSED_MESSAGE);
    expect(paperTradeClosedReason(null, ist(TRADING_DAY, '12:00'))).toBeNull();
  });

  it('never blocks live trades, which go through Kite', () => {
    expect(paperTradeClosedReason('live', ist('2026-10-17', '11:00'))).toBeNull();
    expect(paperTradeClosedReason('live', ist(TRADING_DAY, '20:00'))).toBeNull();
  });
});

const todayStart = '2026-11-03T18:30:00.000Z'; // 4 Nov 2026, 00:00 IST
// IST midnights, as UTC instants.
const OCT_1_IST = '2026-09-30T18:30:00.000Z';
const NOV_1_IST = '2026-10-31T18:30:00.000Z';
const PNL = "CASE WHEN side = 'BUY' THEN (exit_price - entry_price) * quantity ELSE (entry_price - exit_price) * quantity END";

describe('parsePositionsQuery', () => {
  it('without status takes only mode', () => {
    expect(parsePositionsQuery({ mode: 'paper' })).toEqual({ filter: { mode: 'paper' } });
    expect(parsePositionsQuery({})).toEqual({ filter: { mode: null } });
  });

  it('rejects closed-trade filters without status=closed', () => {
    expect(parsePositionsQuery({ mode: 'paper', from: '2026-10-01', limit: '5' }))
      .toEqual({ error: 'from, limit can only be used with status=closed' });
  });

  it('with status=closed reads every filter', () => {
    expect(parsePositionsQuery({
      mode: 'paper', status: 'closed', from: '2026-10-01', to: '2026-10-31', segment: 'options', limit: '50', offset: '100',
    })).toEqual({
      filter: { mode: 'paper', status: 'closed', from: '2026-10-01', to: '2026-10-31', segment: 'options', limit: 50, offset: 100 },
    });
  });

  it('with status=closed defaults to the first 100 trades of any date', () => {
    expect(parsePositionsQuery({ status: 'closed' })).toEqual({
      filter: { mode: null, status: 'closed', from: undefined, to: undefined, segment: undefined, limit: 100, offset: 0 },
    });
  });

  it.each([
    ['unknown status', { status: 'open' }, /^status must be/],
    ['unknown mode', { mode: 'demo' }, /^mode must be/],
    ['unknown segment', { status: 'closed', segment: 'futures' }, /^segment must be/],
    ['bad from', { status: 'closed', from: '01-10-2026' }, /^from must be a date/],
    ['impossible date', { status: 'closed', to: '2026-02-30' }, /^to must be a date/],
    ['from after to', { status: 'closed', from: '2026-11-02', to: '2026-11-01' }, /^from must not be after to/],
    ['zero limit', { status: 'closed', limit: '0' }, /^limit must be/],
    ['limit over 500', { status: 'closed', limit: '501' }, /^limit must be/],
    ['fractional limit', { status: 'closed', limit: '2.5' }, /^limit must be/],
    ['negative offset', { status: 'closed', offset: '-1' }, /^offset must be/],
    ['repeated value', { status: 'closed', limit: ['5', '6'] }, /^limit must be/],
  ])('rejects %s', (_label, query, message) => {
    expect(parsePositionsQuery(query).error).toMatch(message);
  });
});

describe('parseDailyPnlQuery', () => {
  it('reads mode, range and segment', () => {
    expect(parseDailyPnlQuery({ mode: 'paper', from: '2025-11-04', to: '2026-11-04', segment: 'options' })).toEqual({
      filter: { mode: 'paper', from: '2025-11-04', to: '2026-11-04', segment: 'options' },
    });
  });

  it('requires from and to', () => {
    expect(parseDailyPnlQuery({ mode: 'paper', from: '2026-10-01' })).toEqual({ error: 'from and to are required' });
    expect(parseDailyPnlQuery({ mode: 'paper' })).toEqual({ error: 'from and to are required' });
  });

  it('allows a year including a leap day, but not more', () => {
    expect(parseDailyPnlQuery({ from: '2027-03-01', to: '2028-03-01' })).toHaveProperty('filter'); // 366 days
    expect(parseDailyPnlQuery({ from: '2025-11-04', to: '2026-11-06' }))
      .toEqual({ error: 'from and to must be at most 366 days apart' });
  });
});

describe('parseStatsQuery', () => {
  it('takes an optional mode', () => {
    expect(parseStatsQuery({ mode: 'live' })).toEqual({ filter: { mode: 'live' } });
    expect(parseStatsQuery({})).toEqual({ filter: { mode: null } });
    expect(parseStatsQuery({ mode: 'x' })).toHaveProperty('error');
  });
});

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

  it('with status=closed pages through exits, latest first, with id breaking ties', () => {
    expect(buildPositionsQuery('U1', { mode: 'paper', status: 'closed', limit: 100, offset: 0, todayStart })).toEqual({
      sql: 'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 AND exited = 1 AND exit_price IS NOT NULL '
        + 'ORDER BY exit_time DESC, id DESC LIMIT $3 OFFSET $4',
      params: ['U1', 'paper', 100, 0],
    });
  });

  it('turns from and to into IST day boundaries, to being inclusive', () => {
    const { sql, params } = buildPositionsQuery('U1', {
      mode: 'paper', status: 'closed', from: '2026-10-01', to: '2026-10-31', segment: 'options', limit: 20, offset: 40, todayStart,
    });
    expect(sql).toBe(
      'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 AND exited = 1 AND exit_price IS NOT NULL '
      + "AND exit_time >= $3 AND exit_time < $4 AND option_type IN ('CE', 'PE') "
      + 'ORDER BY exit_time DESC, id DESC LIMIT $5 OFFSET $6',
    );
    expect(params).toEqual(['U1', 'paper', OCT_1_IST, NOV_1_IST, 20, 40]);
  });

  it('selects stocks as anything that is not a CE or PE', () => {
    const { sql } = buildPositionsQuery('U1', { status: 'closed', segment: 'stocks', limit: 100, offset: 0 });
    expect(sql).toContain("option_type NOT IN ('CE', 'PE')");
  });

  it('passes user input only as parameters, never in the SQL text', () => {
    const { sql, params } = buildPositionsQuery("U1'; DROP TABLE positions;--", { mode: "paper' OR 1=1", todayStart });
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('OR 1=1');
    expect(params).toContain("paper' OR 1=1");
  });
});

describe('buildDailyPnlQuery', () => {
  it('totals P&L and counts trades per IST exit day, newest first', () => {
    expect(buildDailyPnlQuery('U1', { mode: 'paper', from: '2026-10-01', to: '2026-10-31' })).toEqual({
      sql: "SELECT to_char((exit_time::timestamptz) AT TIME ZONE $5, 'YYYY-MM-DD') AS date, "
        + `ROUND(SUM(${PNL})::numeric, 2) AS pnl, COUNT(*) AS trades `
        + 'FROM positions WHERE user_id = $1 AND mode = $2 AND exited = 1 AND exit_price IS NOT NULL '
        + 'AND exit_time >= $3 AND exit_time < $4 GROUP BY 1 ORDER BY 1 DESC',
      params: ['U1', 'paper', OCT_1_IST, NOV_1_IST, 'Asia/Kolkata'],
    });
  });

  it('adds the segment condition when given', () => {
    const { sql } = buildDailyPnlQuery('U1', { from: '2026-10-01', to: '2026-10-31', segment: 'options' });
    expect(sql).toContain("AND option_type IN ('CE', 'PE') GROUP BY 1");
  });
});

describe('buildStatsQueries', () => {
  const queries = buildStatsQueries('U1', { mode: 'paper', todayStart });
  const closed = 'user_id = $1 AND mode = $2 AND exited = 1 AND exit_price IS NOT NULL';

  it('counts wins, losses, averages and today’s exits in one pass', () => {
    expect(queries.summary.params).toEqual(['U1', 'paper', todayStart]);
    expect(queries.summary.sql).toBe(
      'SELECT COUNT(*) AS closed_trades, COUNT(*) FILTER (WHERE pnl > 0) AS winning_trades, '
      + 'COUNT(*) FILTER (WHERE pnl < 0) AS losing_trades, AVG(pnl) FILTER (WHERE pnl > 0) AS avg_win, '
      + 'AVG(pnl) FILTER (WHERE pnl < 0) AS avg_loss, COUNT(*) FILTER (WHERE exit_time >= $3) AS today_trades '
      + `FROM (SELECT ${PNL} AS pnl, exit_time FROM positions WHERE ${closed}) AS closed`,
    );
  });

  it('picks the best and worst single trade', () => {
    expect(queries.best).toEqual({
      sql: `SELECT * FROM positions WHERE ${closed} ORDER BY ${PNL} DESC, exit_time DESC LIMIT 1`,
      params: ['U1', 'paper'],
    });
    expect(queries.worst.sql).toContain(`ORDER BY ${PNL} ASC, exit_time DESC LIMIT 1`);
  });
});
