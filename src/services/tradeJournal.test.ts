import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Position } from './positions';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiClient: { get: apiGet } }));

import { getPositions, getClosedPositions, getDailyPnl, getPositionStats } from './positions';
import { chargesTitle, getPaperTrades, getPaperDailyPnl, getPaperTradeStats, hasTradeMeta, journalTotals, positionToEntry, positionToSegment } from './tradeJournal';
import { Horizon } from '../../shared/horizons.js';

function position(overrides: Partial<Position>): Position {
  return {
    id: 'p1',
    mode: 'paper',
    tradingsymbol: 'NIFTY26NOV24000CE',
    instrumentToken: 1001,
    instrumentType: 'CE',
    exchange: 'NFO',
    source: 'manual',
    horizon: Horizon.Intraday,
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

describe('journalTotals', () => {
  it('adds the charges back for the P&L before them, and realised P&L is that minus the charges', () => {
    const days = [{ pnl: 950, charges: 50 }, { pnl: -230, charges: 30 }];
    expect(journalTotals(days)).toEqual({ pnl: 800, charges: 80, realised: 720 });
  });

  it('is all zero with no days', () => {
    expect(journalTotals([])).toEqual({ pnl: 0, charges: 0, realised: 0 });
  });
});

describe('hasTradeMeta', () => {
  it('is true when any of confidence, target, stop-loss or note is set, including 0', () => {
    expect(hasTradeMeta({ confidence: 0 })).toBe(true);
    expect(hasTradeMeta({ targetPrice: 120 })).toBe(true);
    expect(hasTradeMeta({ stopLossPrice: 80 })).toBe(true);
    expect(hasTradeMeta({ note: 'Wall Defense' })).toBe(true);
  });

  it('is false when none is set, so no empty line shows under the symbol', () => {
    expect(hasTradeMeta({})).toBe(false);
    expect(hasTradeMeta({ confidence: null, targetPrice: null, stopLossPrice: null, note: '' })).toBe(false);
  });
});

describe('positionToSegment', () => {
  it('sorts positions into options, futures and stocks by instrument type', () => {
    expect(positionToSegment(position({ instrumentType: 'CE' }))).toBe('options');
    expect(positionToSegment(position({ instrumentType: 'PE', optionType: 'PE' }))).toBe('options');
    expect(positionToSegment(position({ instrumentType: 'FUT', optionType: null, strike: null }))).toBe('futures');
    expect(positionToSegment(position({ instrumentType: 'EQ', optionType: null, strike: null, expiry: null }))).toBe('stocks');
  });
});

describe('positionToEntry', () => {
  it('works out P&L for buys and sells', () => {
    expect(positionToEntry(position({ side: 'BUY', entryPrice: 100, exitPrice: 120, quantity: 75 })).pnl).toBe(1500);
    expect(positionToEntry(position({ side: 'SELL', entryPrice: 100, exitPrice: 120, quantity: 75 })).pnl).toBe(-1500);
  });

  it('takes its charges off the P&L, and counts none on trades closed before charges were kept', () => {
    const charged = positionToEntry(position({ side: 'BUY', entryPrice: 100, exitPrice: 120, quantity: 75, charges: 48.36 }));
    expect(charged).toMatchObject({ pnl: 1451.64, charges: 48.36 });
    expect(positionToEntry(position({ side: 'BUY', entryPrice: 100, exitPrice: 120, quantity: 75, charges: null }))).toMatchObject({ pnl: 1500, charges: 0 });
  });

  it('dates a trade by its IST exit day, not the UTC one', () => {
    // 20 Oct 23:00 UTC is 21 Oct 04:30 IST.
    expect(positionToEntry(position({ exitTime: '2026-10-20T23:00:00.000Z' })).date).toBe('2026-10-21');
  });

  it('gives each entry the segment of its instrument type', () => {
    expect(positionToEntry(position({ instrumentType: 'PE', optionType: 'PE' })).segment).toBe('options');
    expect(positionToEntry(position({ instrumentType: 'EQ', optionType: null, strike: null, expiry: null })).segment).toBe('stocks');
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

describe('chargesTitle', () => {
  it('lists each charge paid, one per line, and says when none were recorded', () => {
    const breakdown = { brokerage: 40, stt: 6.75, exchange: 2.4, sebi: 0, stamp: 0.07, gst: 7.63, dp: 0, total: 56.85 };
    expect(chargesTitle(breakdown)).toBe('Brokerage ₹40.00\nSTT ₹6.75\nExchange ₹2.40\nStamp duty ₹0.07\nGST ₹7.63');
    expect(chargesTitle(null)).toMatch(/No charges recorded/);
  });
});
