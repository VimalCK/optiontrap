import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Position } from './positions';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiClient: { get: apiGet } }));

import { getPositions, getClosedPositions, getDailyPnl, getPositionStats } from './positions';
import { getPaperTrades, getPaperDailyPnl, getPaperTradeStats, positionToEntry } from './tradeJournal';

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

  it('getClosedPositions sends only the filters given', async () => {
    await getClosedPositions('paper');
    expect(apiGet).toHaveBeenLastCalledWith('/api/positions?mode=paper&status=closed');

    await getClosedPositions('paper', { from: '2026-11-03', to: '2026-11-03', segment: 'options', limit: 100, offset: 200 });
    expect(apiGet).toHaveBeenLastCalledWith(
      '/api/positions?mode=paper&status=closed&from=2026-11-03&to=2026-11-03&segment=options&limit=100&offset=200',
    );
  });

  it('getDailyPnl always sends the range', async () => {
    await getDailyPnl('paper', '2025-11-04', '2026-11-04');
    expect(apiGet).toHaveBeenLastCalledWith('/api/positions/daily-pnl?mode=paper&from=2025-11-04&to=2026-11-04');

    await getDailyPnl('paper', '2025-11-04', '2026-11-04', 'options');
    expect(apiGet).toHaveBeenLastCalledWith('/api/positions/daily-pnl?mode=paper&from=2025-11-04&to=2026-11-04&segment=options');
  });

  it('getPositionStats asks for one mode', async () => {
    apiGet.mockResolvedValue({});
    await getPositionStats('paper');
    expect(apiGet).toHaveBeenCalledWith('/api/positions/stats?mode=paper');
  });
});

describe('positionToEntry', () => {
  it('works out P&L for buys and sells', () => {
    expect(positionToEntry(position({ side: 'BUY', entryPrice: 100, exitPrice: 120, quantity: 75 })).pnl).toBe(1500);
    expect(positionToEntry(position({ side: 'SELL', entryPrice: 100, exitPrice: 120, quantity: 75 })).pnl).toBe(-1500);
  });

  it('dates a trade by its IST exit day, not the UTC one', () => {
    // 20 Oct 23:00 UTC is 21 Oct 04:30 IST.
    expect(positionToEntry(position({ exitTime: '2026-10-20T23:00:00.000Z' })).date).toBe('2026-10-21');
  });

  it('calls CE/PE options and anything else stocks', () => {
    expect(positionToEntry(position({ optionType: 'PE' })).segment).toBe('options');
    expect(positionToEntry(position({ optionType: 'EQ' as Position['optionType'] })).segment).toBe('stocks');
  });
});

describe('getPaperTrades', () => {
  it('asks the server for one page of paper trades and maps them', async () => {
    apiGet.mockResolvedValue([position({ id: 'a' }), position({ id: 'b', exitPrice: 90 })]);

    const trades = await getPaperTrades({ from: '2026-10-20', to: '2026-10-20', limit: 100 });

    expect(apiGet).toHaveBeenCalledWith('/api/positions?mode=paper&status=closed&from=2026-10-20&to=2026-10-20&limit=100');
    expect(trades.map((t) => [t.id, t.pnl])).toEqual([['a', 1500], ['b', -750]]);
  });
});

describe('getPaperDailyPnl', () => {
  it('returns the server’s per-day totals as they are', async () => {
    const days = [{ date: '2026-11-03', pnl: 2450.5, trades: 12 }];
    apiGet.mockResolvedValue(days);

    expect(await getPaperDailyPnl('2026-10-01', '2026-11-04', 'options')).toEqual(days);
    expect(apiGet).toHaveBeenCalledWith('/api/positions/daily-pnl?mode=paper&from=2026-10-01&to=2026-11-04&segment=options');
  });
});

describe('getPaperTradeStats', () => {
  it('maps the best and worst trades to journal entries', async () => {
    apiGet.mockResolvedValue({
      closedTrades: 3, winningTrades: 2, losingTrades: 1, avgWin: 1000, avgLoss: -500, todayTrades: 1,
      bestTrade: position({ id: 'best', exitPrice: 140 }),
      worstTrade: position({ id: 'worst', exitPrice: 80 }),
    });

    const stats = await getPaperTradeStats();

    expect(stats).toMatchObject({ closedTrades: 3, winningTrades: 2, losingTrades: 1, avgWin: 1000, avgLoss: -500, todayTrades: 1 });
    expect(stats.bestTrade).toMatchObject({ id: 'best', pnl: 3000 });
    expect(stats.worstTrade).toMatchObject({ id: 'worst', pnl: -1500 });
  });

  it('leaves best and worst out when there are no closed trades', async () => {
    apiGet.mockResolvedValue({
      closedTrades: 0, winningTrades: 0, losingTrades: 0, avgWin: 0, avgLoss: 0, todayTrades: 0, bestTrade: null, worstTrade: null,
    });

    const stats = await getPaperTradeStats();

    expect(stats.bestTrade).toBeUndefined();
    expect(stats.worstTrade).toBeUndefined();
  });
});
