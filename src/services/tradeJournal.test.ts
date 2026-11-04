import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Position } from './positions';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiClient: { get: apiGet } }));

import { getPositions, getClosedPositions } from './positions';
import { getPaperTradeEntries, aggregateDailyPnL } from './tradeJournal';

function position(overrides: Partial<Position>): Position {
  return {
    id: 'p1',
    mode: 'paper',
    tradingsymbol: 'NIFTY26NOV24000CE',
    instrumentToken: 1001,
    strike: 24000,
    optionType: 'CE',
    side: 'BUY',
    quantity: 75,
    entryPrice: 100,
    entryTime: '2026-10-20T04:00:00.000Z',
    expiry: '2026-11-24',
    exited: true,
    exitPrice: 120,
    exitTime: '2026-10-20T08:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue([]);
});

describe('positions API URLs', () => {
  it('getPositions asks for current positions only', async () => {
    await getPositions();
    expect(apiGet).toHaveBeenCalledWith('/api/positions?mode=paper');
  });

  it('getClosedPositions asks for every closed position', async () => {
    await getClosedPositions();
    expect(apiGet).toHaveBeenCalledWith('/api/positions?mode=paper&status=closed');
  });
});

describe('getPaperTradeEntries', () => {
  it('loads closed paper positions, including ones from earlier days', async () => {
    apiGet.mockResolvedValue([position({ id: 'old', exitTime: '2026-09-01T08:00:00.000Z' })]);

    const entries = await getPaperTradeEntries();

    expect(apiGet).toHaveBeenCalledWith('/api/positions?mode=paper&status=closed');
    expect(entries.map((e) => [e.id, e.date])).toEqual([['old', '2026-09-01']]);
  });

  it('works out P&L for buys and sells', async () => {
    apiGet.mockResolvedValue([
      position({ id: 'buy', side: 'BUY', entryPrice: 100, exitPrice: 120, quantity: 75 }),
      position({ id: 'sell', side: 'SELL', entryPrice: 100, exitPrice: 120, quantity: 75 }),
    ]);

    const pnl = Object.fromEntries((await getPaperTradeEntries()).map((e) => [e.id, e.pnl]));

    expect(pnl).toEqual({ buy: 1500, sell: -1500 });
  });

  it('skips positions that have no exit price', async () => {
    apiGet.mockResolvedValue([position({ id: 'no-price', exitPrice: undefined })]);
    expect(await getPaperTradeEntries()).toEqual([]);
  });

  it('sorts newest day first', async () => {
    apiGet.mockResolvedValue([
      position({ id: 'a', exitTime: '2026-10-01T08:00:00.000Z' }),
      position({ id: 'b', exitTime: '2026-11-02T08:00:00.000Z' }),
      position({ id: 'c', exitTime: '2026-10-15T08:00:00.000Z' }),
    ]);

    expect((await getPaperTradeEntries()).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('aggregateDailyPnL', () => {
  it('sums P&L per day', async () => {
    apiGet.mockResolvedValue([
      position({ id: 'a', exitPrice: 120, exitTime: '2026-10-20T05:00:00.000Z' }),
      position({ id: 'b', exitPrice: 90, exitTime: '2026-10-20T07:00:00.000Z' }),
      position({ id: 'c', exitPrice: 110, exitTime: '2026-10-21T07:00:00.000Z' }),
    ]);

    const daily = aggregateDailyPnL(await getPaperTradeEntries());

    expect(Object.fromEntries(daily)).toEqual({ '2026-10-20': 750, '2026-10-21': 750 });
  });
});
