import { describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ getNearestExpiryOptions: vi.fn(), getUnderlying: vi.fn() }));
const { buildReplayDay, replayContracts } = await import('./replayDay.js');

const contract = (strike, instrumentType, instrumentToken) => ({
  instrumentToken, tradingsymbol: `X${strike}${instrumentType}`, strike, instrumentType, expiry: '2026-12-01', lotSize: 65,
});

describe('replayContracts', () => {
  it('keeps the strikes from the low ATM to the high ATM plus four each side', () => {
    const contracts = Array.from({ length: 30 }, (_, i) => contract(25000 + i * 50, 'CE', i));
    const strikes = replayContracts(contracts, 25520, 25640).map((c) => c.strike);
    expect(strikes[0]).toBe(25300);
    expect(strikes.at(-1)).toBe(25850);
  });

  it('stops at the ends of the chain', () => {
    const contracts = [contract(25000, 'CE', 1), contract(25050, 'CE', 2)];
    expect(replayContracts(contracts, 24990, 25010)).toHaveLength(2);
  });
});

describe('buildReplayDay', () => {
  const index = [
    ['2026-11-26T09:15:00+0530', 100, 102, 99, 101, 0],
    ['2026-11-26T09:16:00+0530', 101, 103, 100, 102, 0],
    ['2026-11-26T09:17:00+0530', 102, 104, 101, 103, 0],
  ];

  it('aligns each contract to the index minutes, repeating the last close when a minute has no trade', () => {
    const contracts = [contract(100, 'CE', 1), contract(100, 'PE', 2), contract(150, 'CE', 3)];
    const candlesByToken = new Map([
      [1, [['2026-11-26T09:16:00+0530', 5, 6, 4, 5.5, 100, 1000]]],
      [2, [['2026-11-26T09:15:00+0530', 4, 4, 3, 3.5, 50, 2000], ['2026-11-26T09:17:00+0530', 3, 3, 2, 2.5, 10, 2100]]],
      [3, [['2026-11-26T09:15:00+0530', 1, 1, 1, 1, 1, 10]]],
    ]);
    const day = buildReplayDay({ underlying: { name: 'NIFTY', label: 'NIFTY 50' }, date: '2026-11-26', index, contracts, candlesByToken, prevDay: { high: 101, low: 96, close: 98 } });
    expect(day.times).toEqual(['09:15', '09:16', '09:17']);
    expect(day.index[1]).toEqual([101, 103, 100, 102]);
    expect(day.calls['100']).toEqual([null, [5, 5.5, 100, 1000], [5.5, 5.5, 0, 1000]]);
    expect(day.puts['100']).toEqual([[4, 3.5, 50, 2000], [3.5, 3.5, 0, 2000], [3, 2.5, 10, 2100]]);
    // A strike with only one side traded can't show a straddle, so it's left out.
    expect(day.strikes).toEqual([100]);
    expect(day.symbols['100']).toEqual({ CE: 'X100CE', PE: 'X100PE' });
    expect(day).toMatchObject({ expiry: '2026-12-01', lotSize: 65, prevClose: 98, prevDay: { high: 101, low: 96, close: 98 }, label: 'NIFTY 50' });
  });
});
