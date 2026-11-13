import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Horizon } from '../../shared/tradeEnums.js';
import { roundTripCharges } from '../../shared/tradeCharges.js';

vi.mock('../db.js', () => ({
  averageIntoPosition: vi.fn(),
  closeAutoTrades: vi.fn(),
  closeOpenPosition: vi.fn(),
  findOpenPosition: vi.fn(),
  getExecutedAutoTrades: vi.fn(),
  getOpenPosition: vi.fn(),
  insertPosition: vi.fn(),
  setPositionQuantity: vi.fn(),
}));

const db = await import('../db.js');
const {
  openPosition, closablePosition, closePosition, squareOffable, bookedDetails, averagedIn, positionCharges, autoTradeCharges, NOT_FOUND,
} = await import('./positions.js');
const { MARKET_CLOSED_MESSAGE } = await import('../../shared/tradeRules.js');

const OPEN = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const CLOSED = new Date('2026-11-05T14:30:00Z'); // Thu 20:00 IST

const input = {
  tradingsymbol: 'NIFTY26N1024000CE',
  instrumentToken: '12345',
  strike: '24000',
  optionType: 'CE',
  side: 'BUY',
  quantity: '75',
  entryPrice: '101.5',
  expiry: '2026-11-10',
  horizon: Horizon.Intraday,
};

/** An open position in the same instrument as `input`, from the same source and horizon. */
const openPositionOf = (fields) => ({
  id: 'p0', instrumentType: 'CE', side: 'SELL', quantity: 75, entryPrice: 120, entryTime: '2026-11-05T04:00:00.000Z', ...fields,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.findOpenPosition.mockResolvedValue(null);
});

describe('openPosition', () => {
  it('records a valid trade with parsed numbers at its fill and returns the position', async () => {
    db.insertPosition.mockResolvedValue({ id: 'p1' });
    const result = await openPosition('U1', input, { now: OPEN });

    expect(result).toEqual({ ok: true, position: { id: 'p1' } });
    expect(db.insertPosition).toHaveBeenCalledWith('U1', expect.objectContaining({
      instrumentToken: 12345, strike: 24000, quantity: 75, entryPrice: 101.5, mode: 'Paper',
    }), 75, expect.any(String));
  });

  it('records a trade as manual unless the caller says it is automated, never from the request', async () => {
    db.insertPosition.mockResolvedValue({ id: 'p1' });
    await openPosition('U1', { ...input, source: 'Auto' }, { now: OPEN });
    expect(db.insertPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'Manual' }), 75, expect.any(String));

    await openPosition('U1', input, { now: OPEN, source: 'Auto' });
    expect(db.insertPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'Auto' }), 75, expect.any(String));
  });

  it('records a stock trade with no strike or expiry', async () => {
    db.insertPosition.mockResolvedValue({ id: 'p2' });
    const stock = { tradingsymbol: 'RELIANCE', instrumentToken: '738561', instrumentType: 'EQ', side: 'BUY', quantity: '10', entryPrice: '1400', horizon: Horizon.Positional };
    expect(await openPosition('U1', stock, { now: OPEN })).toEqual({ ok: true, position: { id: 'p2' } });
    expect(db.insertPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ instrumentType: 'EQ', exchange: 'NSE', quantity: 10, horizon: Horizon.Positional }), 10, expect.any(String));
  });

  it('refuses an incomplete trade without touching the database', async () => {
    const result = await openPosition('U1', { ...input, side: undefined }, { now: OPEN });
    expect(result).toEqual({ ok: false, code: 'INVALID_TRADE', message: 'Missing required fields', rule: 'required-fields' });
    expect(db.findOpenPosition).not.toHaveBeenCalled();
    expect(db.insertPosition).not.toHaveBeenCalled();
  });

  it('refuses a paper trade while the market is closed', async () => {
    const result = await openPosition('U1', input, { now: CLOSED });
    expect(result).toEqual({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE, rule: 'market-open' });
    expect(db.insertPosition).not.toHaveBeenCalled();
  });

  it('reports the first failing rule when several fail', async () => {
    const result = await openPosition('U1', {}, { now: CLOSED });
    expect(result.rule).toBe('required-fields');
  });
});

describe('openPosition merging with an open position', () => {
  it('looks only at open positions in the same instrument, source, mode and horizon', async () => {
    db.insertPosition.mockResolvedValue({ id: 'p1' });
    await openPosition('U1', input, { now: OPEN, source: 'Auto' });
    const match = { mode: 'Paper', instrumentToken: 12345, source: 'Auto', horizon: Horizon.Intraday };
    expect(db.findOpenPosition).toHaveBeenNthCalledWith(1, 'U1', { ...match, side: 'BUY' });
    expect(db.findOpenPosition).toHaveBeenNthCalledWith(2, 'U1', { ...match, side: 'SELL' });
  });

  it('averages a same-side trade into the open position', async () => {
    db.findOpenPosition.mockResolvedValueOnce(openPositionOf({ side: 'BUY', quantity: 25, entryPrice: 100 }));
    db.averageIntoPosition.mockResolvedValue({ id: 'p0', quantity: 100 });
    expect(await openPosition('U1', input, { now: OPEN })).toEqual({ ok: true, position: { id: 'p0', quantity: 100 } });
    // (25 × 100 + 75 × 101.5) / 100 = 101.125 → 101.13
    expect(db.averageIntoPosition).toHaveBeenCalledWith('p0', { quantity: 100, entryPrice: 101.13 }, expect.objectContaining({ quantity: 75 }));
    expect(db.findOpenPosition).toHaveBeenCalledTimes(1);
    expect(db.insertPosition).not.toHaveBeenCalled();
  });

  it('reduces an opposite position the trade does not cover', async () => {
    db.findOpenPosition.mockResolvedValueOnce(null).mockResolvedValueOnce(openPositionOf({ quantity: 100 }));
    db.setPositionQuantity.mockResolvedValue({ id: 'p0', quantity: 25 });
    expect((await openPosition('U1', input, { now: OPEN })).position).toEqual({ id: 'p0', quantity: 25 });
    expect(db.setPositionQuantity).toHaveBeenCalledWith('p0', 25);
    expect(db.closeOpenPosition).not.toHaveBeenCalled();
  });

  it("closes an opposite position the trade exactly covers, at the trade's price with its charges", async () => {
    const opposite = openPositionOf({ quantity: 75 });
    db.findOpenPosition.mockResolvedValueOnce(null).mockResolvedValueOnce(opposite);
    db.closeOpenPosition.mockResolvedValue({ id: 'p0', exited: true });
    expect((await openPosition('U1', input, { now: OPEN })).position).toEqual({ id: 'p0', exited: true });

    const [id, exit] = db.closeOpenPosition.mock.calls[0];
    expect(id).toBe('p0');
    expect(exit.exitPrice).toBe(101.5);
    expect(exit.charges).toEqual(roundTripCharges(
      { instrumentType: 'CE', side: 'SELL', quantity: 75, entryPrice: 120, entryTime: new Date(opposite.entryTime) }, 101.5, new Date(exit.exitTime),
    ));
    expect(db.insertPosition).not.toHaveBeenCalled();
  });

  it('returns the opposite position as it was when another request closed it first', async () => {
    const opposite = openPositionOf({ quantity: 75 });
    db.findOpenPosition.mockResolvedValueOnce(null).mockResolvedValueOnce(opposite);
    db.closeOpenPosition.mockResolvedValue(null);
    expect((await openPosition('U1', input, { now: OPEN })).position).toBe(opposite);
  });

  it('closes an opposite position the trade more than covers and opens the rest the other way', async () => {
    db.findOpenPosition.mockResolvedValueOnce(null).mockResolvedValueOnce(openPositionOf({ quantity: 50 }));
    db.closeOpenPosition.mockResolvedValue({ id: 'p0', exited: true });
    db.insertPosition.mockResolvedValue({ id: 'p1', quantity: 25 });
    expect((await openPosition('U1', input, { now: OPEN })).position).toEqual({ id: 'p1', quantity: 25 });
    expect(db.closeOpenPosition).toHaveBeenCalledWith('p0', expect.objectContaining({ exitPrice: 101.5 }));
    expect(db.insertPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ side: 'BUY' }), 25, expect.any(String));
  });
});

describe('averagedIn', () => {
  it('sums the quantity and averages the price to 2 decimals', () => {
    expect(averagedIn({ quantity: 100, entryPrice: 10 }, { quantity: 500, entryPrice: 12 })).toEqual({ quantity: 600, entryPrice: 11.67 });
  });
});

describe('charges', () => {
  it("prices a position's round trip from its own entry", () => {
    const position = { instrumentType: 'CE', side: 'BUY', quantity: 75, entryPrice: 100, entryTime: '2026-11-05T04:00:00.000Z' };
    expect(positionCharges(position, 110, OPEN))
      .toEqual(roundTripCharges({ ...position, entryTime: new Date(position.entryTime) }, 110, OPEN));
  });

  it("prices an automated trade's round trip, at the exit price when it has no entry price", () => {
    const trade = { side: 'BUY', quantity: 75, entryPrice: 100, createdAt: new Date('2026-11-05T04:00:00Z') };
    const at = (entryPrice) => roundTripCharges({ instrumentType: 'CE', side: 'BUY', quantity: 75, entryPrice, entryTime: trade.createdAt }, 110, OPEN).total;
    expect(autoTradeCharges(trade, 'CE', 110, OPEN)).toBe(at(100));
    expect(autoTradeCharges({ ...trade, entryPrice: null }, 'CE', 110, OPEN)).toBe(at(110));
  });
});

describe('closablePosition', () => {
  const position = { id: 'p1', mode: 'Paper', exited: false };

  it('gives the open position when it may be closed at that price now', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    expect(await closablePosition('U1', 'p1', 95.5, OPEN)).toEqual({ ok: true, position });
    expect(db.getOpenPosition).toHaveBeenCalledWith('p1', 'U1');
  });

  it("returns NOT_FOUND for a missing, exited or other user's position", async () => {
    db.getOpenPosition.mockResolvedValue(null);
    expect(await closablePosition('U1', 'p1', 95, OPEN)).toEqual({ ok: false, code: NOT_FOUND, message: 'Position not found or already exited' });
  });

  it('refuses without an exit price, or a paper exit while the market is closed', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    expect(await closablePosition('U1', 'p1', undefined, OPEN)).toMatchObject({ ok: false, code: 'INVALID_TRADE', rule: 'exit-price-given' });
    expect(await closablePosition('U1', 'p1', 95, CLOSED)).toMatchObject({ ok: false, code: 'MARKET_CLOSED', rule: 'market-open' });
  });

  it('lets a live position close while the market is closed', async () => {
    db.getOpenPosition.mockResolvedValue({ ...position, mode: 'Live' });
    expect((await closablePosition('U1', 'p1', 95, CLOSED)).ok).toBe(true);
  });
});

describe('squareOffable', () => {
  const position = { id: 'p1', mode: 'Paper', exited: false };

  it('allows the engine to square off after the close, at a given price', () => {
    expect(squareOffable(position, 95.5, CLOSED)).toEqual({ ok: true, position });
  });

  it('refuses a square-off without a price', () => {
    expect(squareOffable(position, undefined, CLOSED)).toMatchObject({ ok: false, code: 'INVALID_TRADE', rule: 'exit-price-given' });
  });
});

describe('closePosition', () => {
  const position = { id: 'p1', mode: 'Paper', exited: false, instrumentType: 'CE', side: 'BUY', quantity: 75, entryPrice: 100, entryTime: '2026-11-05T04:00:00.000Z' };
  const reread = { ...position, quantity: 150, entryPrice: 102 };

  it("closes the position as it is now at the fill, with that position's charges, dated when it happens", async () => {
    const exited = { ...reread, exited: true, exitPrice: 95.5, charges: 48.2 };
    db.getOpenPosition.mockResolvedValue(reread);
    db.closeOpenPosition.mockResolvedValue(exited);
    expect(await closePosition('U1', position, 95.5, { now: OPEN })).toEqual({ ok: true, position: exited });
    expect(db.getOpenPosition).toHaveBeenCalledWith('p1', 'U1');
    expect(db.closeOpenPosition).toHaveBeenCalledWith('p1', {
      exitPrice: 95.5, exitTime: OPEN.toISOString(), charges: positionCharges(reread, 95.5, OPEN),
    });
  });

  it('closes the automated trades behind an automated position, each with its own charges, as exited manually unless told why', async () => {
    const auto = { ...position, source: 'Auto' };
    const trades = [
      { id: 't1', side: 'BUY', quantity: 75, entryPrice: 100, createdAt: new Date('2026-11-05T04:00:00Z') },
      { id: 't2', side: 'BUY', quantity: 75, entryPrice: null, createdAt: new Date('2026-11-05T05:00:00Z') },
    ];
    db.getOpenPosition.mockResolvedValue(auto);
    db.closeOpenPosition.mockResolvedValue({ ...auto, exited: true });
    db.getExecutedAutoTrades.mockResolvedValue(trades);

    expect((await closePosition('U1', auto, 95.5, { now: OPEN })).ok).toBe(true);
    expect(db.getExecutedAutoTrades).toHaveBeenCalledWith('U1', 'p1');
    expect(db.closeAutoTrades).toHaveBeenCalledWith('U1', 'p1', [
      { id: 't1', charges: autoTradeCharges(trades[0], 'CE', 95.5, OPEN) },
      { id: 't2', charges: autoTradeCharges(trades[1], 'CE', 95.5, OPEN) },
    ], 95.5, { ruleId: null, reason: 'Exited manually' });

    await closePosition('U1', auto, 90, { now: OPEN, exitReason: { ruleId: 'stop-loss', reason: 'Stop-loss hit' } });
    expect(db.closeAutoTrades).toHaveBeenLastCalledWith('U1', 'p1', expect.any(Array), 90, { ruleId: 'stop-loss', reason: 'Stop-loss hit' });
  });

  it('leaves automated trades alone for a manual position, or a close another request beat', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    db.closeOpenPosition.mockResolvedValue({ ...position, exited: true });
    await closePosition('U1', { ...position, source: 'Manual' }, 95, { now: OPEN });

    db.closeOpenPosition.mockResolvedValue(null);
    expect(await closePosition('U1', { ...position, source: 'Auto' }, 95, { now: OPEN })).toMatchObject({ ok: false, code: NOT_FOUND });

    db.getOpenPosition.mockResolvedValue(null);
    expect(await closePosition('U1', { ...position, source: 'Auto' }, 95, { now: OPEN })).toMatchObject({ ok: false, code: NOT_FOUND });
    expect(db.closeAutoTrades).not.toHaveBeenCalled();
  });
});

describe('bookedDetails', () => {
  const sold = { side: 'SELL', quantity: 75, entryPrice: 100, tradingsymbol: 'NIFTY26NOV24000PE' };

  it('gives the P&L before and after charges, and why it was exited', () => {
    expect(bookedDetails('U1', sold, { charges: 48.2 }, 90, { reason: 'Target hit' })).toEqual({
      trade: 'SELL 75 NIFTY26NOV24000PE', entry: 100, exit: 90,
      'P&L': '₹750.00', charges: '₹48.20', net: '₹701.80', user: 'U1', reason: 'Target hit',
    });
  });

  it('counts no charges when none were recorded', () => {
    expect(bookedDetails('U1', { ...sold, side: 'BUY' }, { charges: null }, 90, { reason: 'Exited manually' }))
      .toMatchObject({ 'P&L': '₹-750.00', charges: '₹0.00', net: '₹-750.00' });
  });
});
