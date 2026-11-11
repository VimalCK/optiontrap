import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Horizon } from '../../shared/horizons.js';

vi.mock('../db.js', () => ({
  addPosition: vi.fn(),
  exitPositionById: vi.fn(),
  getOpenPosition: vi.fn(),
  closeAutoTradesOfPosition: vi.fn(),
}));

const db = await import('../db.js');
const { openPosition, closablePosition, closePosition, squareOffable, bookedDetails, NOT_FOUND } = await import('./positions.js');
const { MARKET_CLOSED_MESSAGE } = await import('../../shared/paperTradeRules.js');

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

beforeEach(() => vi.clearAllMocks());

describe('openPosition', () => {
  it('records a valid trade with parsed numbers at its fill and returns the position', async () => {
    db.addPosition.mockResolvedValue({ id: 'p1' });
    const result = await openPosition('U1', input, { now: OPEN });

    expect(result).toEqual({ ok: true, position: { id: 'p1' } });
    expect(db.addPosition).toHaveBeenCalledWith('U1', expect.objectContaining({
      instrumentToken: 12345, strike: 24000, quantity: 75, entryPrice: 101.5, mode: 'paper',
    }));
  });

  it('records a trade as manual unless the caller says it is automated, never from the request', async () => {
    db.addPosition.mockResolvedValue({ id: 'p1' });
    await openPosition('U1', { ...input, source: 'auto' }, { now: OPEN });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'manual' }));

    await openPosition('U1', input, { now: OPEN, source: 'auto' });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'auto' }));
  });

  it('records a stock trade with no strike or expiry', async () => {
    db.addPosition.mockResolvedValue({ id: 'p2' });
    const stock = { tradingsymbol: 'RELIANCE', instrumentToken: '738561', instrumentType: 'EQ', side: 'BUY', quantity: '10', entryPrice: '1400', horizon: Horizon.Positional };
    expect(await openPosition('U1', stock, { now: OPEN })).toEqual({ ok: true, position: { id: 'p2' } });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ instrumentType: 'EQ', exchange: 'NSE', quantity: 10, horizon: Horizon.Positional }));
  });

  it('refuses an incomplete trade without touching the database', async () => {
    const result = await openPosition('U1', { ...input, side: undefined }, { now: OPEN });
    expect(result).toEqual({ ok: false, code: 'INVALID_TRADE', message: 'Missing required fields', rule: 'required-fields' });
    expect(db.addPosition).not.toHaveBeenCalled();
  });

  it('refuses a paper trade while the market is closed', async () => {
    const result = await openPosition('U1', input, { now: CLOSED });
    expect(result).toEqual({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE, rule: 'market-open' });
    expect(db.addPosition).not.toHaveBeenCalled();
  });

  it('reports the first failing rule when several fail', async () => {
    const result = await openPosition('U1', {}, { now: CLOSED });
    expect(result.rule).toBe('required-fields');
  });
});

describe('closablePosition', () => {
  const position = { id: 'p1', mode: 'paper', exited: false };

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
    db.getOpenPosition.mockResolvedValue({ ...position, mode: 'live' });
    expect((await closablePosition('U1', 'p1', 95, CLOSED)).ok).toBe(true);
  });
});

describe('squareOffable', () => {
  const position = { id: 'p1', mode: 'paper', exited: false };

  it('allows the engine to square off after the close, at a given price', () => {
    expect(squareOffable(position, 95.5, CLOSED)).toEqual({ ok: true, position });
  });

  it('refuses a square-off without a price', () => {
    expect(squareOffable(position, undefined, CLOSED)).toMatchObject({ ok: false, code: 'INVALID_TRADE', rule: 'exit-price-given' });
  });
});

describe('closePosition', () => {
  const position = { id: 'p1', mode: 'paper', exited: false };

  it('closes the position at the fill, and returns it as exited (with its charges)', async () => {
    const exited = { ...position, exited: true, exitPrice: 95.5, charges: 48.2 };
    db.exitPositionById.mockResolvedValue(exited);
    expect(await closePosition('U1', position, 95.5, { now: OPEN })).toEqual({ ok: true, position: exited });
    expect(db.exitPositionById).toHaveBeenCalledWith('p1', 'U1', 95.5, OPEN); // dated when it happens
  });

  it('closes the automated trades behind an automated position, as exited manually unless told why', async () => {
    const auto = { ...position, source: 'auto' };
    db.exitPositionById.mockResolvedValue({ ...auto, exited: true });

    expect((await closePosition('U1', auto, 95.5, { now: OPEN })).ok).toBe(true);
    expect(db.closeAutoTradesOfPosition).toHaveBeenCalledWith('U1', auto, 95.5, { ruleId: null, reason: 'Exited manually' }, OPEN);

    await closePosition('U1', auto, 90, { now: OPEN, exitReason: { ruleId: 'stop-loss', reason: 'Stop-loss hit' } });
    expect(db.closeAutoTradesOfPosition).toHaveBeenLastCalledWith('U1', auto, 90, { ruleId: 'stop-loss', reason: 'Stop-loss hit' }, OPEN);
  });

  it('leaves automated trades alone for a manual position, or a close another request beat', async () => {
    db.exitPositionById.mockResolvedValue({ ...position, exited: true });
    await closePosition('U1', { ...position, source: 'manual' }, 95, { now: OPEN });

    db.exitPositionById.mockResolvedValue(null);
    expect(await closePosition('U1', { ...position, source: 'auto' }, 95, { now: OPEN })).toMatchObject({ ok: false, code: NOT_FOUND });
    expect(db.closeAutoTradesOfPosition).not.toHaveBeenCalled();
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
