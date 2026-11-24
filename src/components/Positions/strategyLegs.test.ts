import { describe, it, expect } from 'vitest';
import type { Position } from '@/services/positions';
import { paperPositionPnl } from './paperPnl';
import { positionRows } from './strategyLegs';

const position = (id: string, extra: Partial<Position> = {}): Position => ({
  id, tradingsymbol: 'NIFTY26N2425000PE', instrumentToken: 101, strike: 25000, optionType: 'PE', expiry: '2026-11-24',
  side: 'SELL', quantity: 75, entryPrice: 100, entryTime: '2026-11-24T05:00:00.000Z', exited: false,
  mode: 'Paper', instrumentType: 'PE', exchange: 'NFO', source: 'Auto', strategyId: 'a', horizon: 'Intraday', ...extra,
} as Position);

describe('positionRows', () => {
  it("combines two strategies' open positions in one instrument, as the broker nets them, keeping each as a leg", () => {
    const a = position('p1', { quantity: 75, entryPrice: 100, entryTime: '2026-11-24T05:10:00.000Z' });
    const b = position('p2', { strategyId: 'b', quantity: 150, entryPrice: 110, entryTime: '2026-11-24T05:00:00.000Z' });
    const [row, ...rest] = positionRows([a, b]);
    expect(rest).toEqual([]);
    expect(row.legs).toEqual([a, b]);
    // (75 × 100 + 150 × 110) / 225 = 106.67, entered when the first leg was.
    expect(row.position).toMatchObject({ id: 'p1+p2', strategyId: null, quantity: 225, entryTime: '2026-11-24T05:00:00.000Z' });
    expect(row.position.entryPrice).toBeCloseTo(106.6667, 4);
  });

  it("gives the combined row the legs' P&L summed", () => {
    const legs = [position('p1', { entryPrice: 100 }), position('p2', { strategyId: 'b', quantity: 150, entryPrice: 110 })];
    const [row] = positionRows(legs);
    const summed = legs.reduce((total, leg) => total + paperPositionPnl(leg, 90).value, 0);
    expect(paperPositionPnl(row.position, 90).value).toBeCloseTo(summed, 6);
  });

  it('keeps a single position, manual ones, exited ones and other sides, modes or horizons as rows of their own, in order', () => {
    const positions = [
      position('p1'),
      position('m1', { source: 'Manual', strategyId: null }),
      position('x1', { strategyId: 'b', exited: true, exitPrice: 90 }),
      position('s1', { strategyId: 'b', side: 'BUY' }),
      position('h1', { strategyId: 'b', horizon: 'Positional' }),
      position('o1', { strategyId: 'b', instrumentToken: 202 }),
    ];
    expect(positionRows(positions).map((row) => [row.position.id, row.legs.length])).toEqual(positions.map((p) => [p.id, 0]));
  });

  it('puts the combined row where its first leg was', () => {
    const rows = positionRows([position('m1', { source: 'Manual', strategyId: null }), position('p1'), position('o1', { instrumentToken: 202 }), position('p2', { strategyId: 'b' })]);
    expect(rows.map((row) => row.position.id)).toEqual(['m1', 'p1+p2', 'o1']);
  });
});
