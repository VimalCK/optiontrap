import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  addPosition: vi.fn(),
  exitPositionById: vi.fn(),
  getOpenPosition: vi.fn(),
  closeAutoTradesOfPosition: vi.fn(),
}));

const db = await import('./db.js');
const { openPaperTrade, exitPaperTrade, bookedDetails, NOT_FOUND } = await import('./paperTrading.js');
const { MARKET_CLOSED_MESSAGE } = await import('../shared/paperTradeRules.js');

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
};

beforeEach(() => vi.clearAllMocks());

describe('openPaperTrade', () => {
  it('records a valid trade with parsed numbers and returns the position', async () => {
    db.addPosition.mockResolvedValue({ id: 'p1' });
    const result = await openPaperTrade('U1', input, { now: OPEN });

    expect(result).toEqual({ ok: true, position: { id: 'p1' } });
    expect(db.addPosition).toHaveBeenCalledWith('U1', expect.objectContaining({
      instrumentToken: 12345, strike: 24000, quantity: 75, entryPrice: 101.5, mode: 'paper',
    }));
  });

  it('records a trade as manual unless the caller says it is automated', async () => {
    db.addPosition.mockResolvedValue({ id: 'p1' });
    await openPaperTrade('U1', input, { now: OPEN });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'manual' }));

    await openPaperTrade('U1', input, { now: OPEN, source: 'auto' });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'auto' }));
  });

  it('fills a market order at the ask for a buy when given a Kite session, never the price sent', async () => {
    db.addPosition.mockResolvedValue({ id: 'p1' });
    const kite = { apiKey: 'k', accessToken: 't' };
    const fillPrice = vi.fn().mockResolvedValue(102);
    await openPaperTrade('U1', input, { now: OPEN, fillFrom: kite, fillPrice });
    expect(fillPrice).toHaveBeenCalledWith(kite, expect.objectContaining({ tradingsymbol: 'NIFTY26N1024000CE', exchange: 'NFO' }), 'BUY');
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ entryPrice: 102 }));

    // A limit fill (no session) keeps its price, and so does a refused trade: no quote is taken for it.
    await openPaperTrade('U1', input, { now: OPEN, fillPrice });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ entryPrice: 101.5 }));
    await openPaperTrade('U1', input, { now: CLOSED, fillFrom: kite, fillPrice });
    expect(fillPrice).toHaveBeenCalledTimes(1);
  });

  it('never takes the source from the request itself', async () => {
    db.addPosition.mockResolvedValue({ id: 'p1' });
    await openPaperTrade('U1', { ...input, source: 'auto' }, { now: OPEN });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ source: 'manual' }));
  });

  it('records a stock trade with no strike or expiry', async () => {
    db.addPosition.mockResolvedValue({ id: 'p2' });
    const stock = { tradingsymbol: 'RELIANCE', instrumentToken: '738561', instrumentType: 'EQ', side: 'BUY', quantity: '10', entryPrice: '1400' };
    expect(await openPaperTrade('U1', stock, { now: OPEN })).toEqual({ ok: true, position: { id: 'p2' } });
    expect(db.addPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ instrumentType: 'EQ', exchange: 'NSE', quantity: 10 }));
  });

  it('refuses an incomplete trade without touching the database', async () => {
    const result = await openPaperTrade('U1', { ...input, side: undefined }, { now: OPEN });
    expect(result).toEqual({ ok: false, code: 'INVALID_TRADE', message: 'Missing required fields', rule: 'required-fields' });
    expect(db.addPosition).not.toHaveBeenCalled();
  });

  it('refuses a paper trade while the market is closed', async () => {
    const result = await openPaperTrade('U1', input, { now: CLOSED });
    expect(result).toEqual({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE, rule: 'market-open' });
    expect(db.addPosition).not.toHaveBeenCalled();
  });

  it('reports the first failing rule when several fail', async () => {
    const result = await openPaperTrade('U1', {}, { now: CLOSED });
    expect(result.rule).toBe('required-fields');
  });
});

describe('exitPaperTrade', () => {
  const position = { id: 'p1', mode: 'paper', exited: false };

  it('exits an open position at the given price, and returns it as exited (with its charges)', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    const exited = { ...position, exited: true, exitPrice: 95.5, charges: 48.2 };
    db.exitPositionById.mockResolvedValue(exited);

    const result = await exitPaperTrade('U1', 'p1', '95.5', { now: OPEN });

    expect(result).toEqual({ ok: true, position: exited });
    expect(db.getOpenPosition).toHaveBeenCalledWith('p1', 'U1');
    expect(db.exitPositionById).toHaveBeenCalledWith('p1', 'U1', 95.5);
  });

  it('returns NOT_FOUND for a missing, exited or other user’s position', async () => {
    db.getOpenPosition.mockResolvedValue(null);
    const result = await exitPaperTrade('U1', 'p1', 95, { now: OPEN });
    expect(result).toEqual({ ok: false, code: NOT_FOUND, message: 'Position not found or already exited' });
    expect(db.exitPositionById).not.toHaveBeenCalled();
  });

  it('refuses without an exit price', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    const result = await exitPaperTrade('U1', 'p1', undefined, { now: OPEN });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TRADE', rule: 'exit-price-given' });
    expect(db.exitPositionById).not.toHaveBeenCalled();
  });

  it('refuses a paper exit while the market is closed', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    const result = await exitPaperTrade('U1', 'p1', 95, { now: CLOSED });
    expect(result).toMatchObject({ ok: false, code: 'MARKET_CLOSED', rule: 'market-open' });
    expect(db.exitPositionById).not.toHaveBeenCalled();
  });

  it('closes the automated trades behind an automated position, as exited manually unless told why', async () => {
    const auto = { ...position, source: 'auto' };
    db.getOpenPosition.mockResolvedValue(auto);
    db.exitPositionById.mockResolvedValue({ ...auto, exited: true });

    expect((await exitPaperTrade('U1', 'p1', '95.5', { now: OPEN })).ok).toBe(true);
    expect(db.closeAutoTradesOfPosition).toHaveBeenCalledWith('U1', auto, 95.5, { ruleId: null, reason: 'Exited manually' }, OPEN);

    await exitPaperTrade('U1', 'p1', 90, { now: OPEN, exitReason: { ruleId: 'stop-loss', reason: 'Stop-loss hit' } });
    expect(db.closeAutoTradesOfPosition).toHaveBeenLastCalledWith('U1', auto, 90, { ruleId: 'stop-loss', reason: 'Stop-loss hit' }, OPEN);
  });

  it('exits as a market order at the bid / ask when given a Kite session, else at the price sent', async () => {
    const sold = { ...position, side: 'SELL', exchange: 'NFO', tradingsymbol: 'NIFTY26N1024000PE' };
    db.getOpenPosition.mockResolvedValue(sold);
    db.exitPositionById.mockResolvedValue({ ...sold, exited: true });
    const kite = { apiKey: 'k', accessToken: 't' };
    const fillPrice = vi.fn().mockResolvedValue(30.2);

    await exitPaperTrade('U1', 'p1', 30, { now: OPEN, fillFrom: kite, fillPrice });
    // A sold position exits by buying, so it pays the ask.
    expect(fillPrice).toHaveBeenCalledWith(kite, sold, 'BUY');
    expect(db.exitPositionById).toHaveBeenLastCalledWith('p1', 'U1', 30.2);

    fillPrice.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('quote failed'));
    await exitPaperTrade('U1', 'p1', 30, { now: OPEN, fillFrom: kite, fillPrice }); // no bid / ask in the quote
    expect(db.exitPositionById).toHaveBeenLastCalledWith('p1', 'U1', 30);
    await exitPaperTrade('U1', 'p1', 30, { now: OPEN, fillFrom: kite, fillPrice }); // the quote call failed
    expect(db.exitPositionById).toHaveBeenLastCalledWith('p1', 'U1', 30);
  });

  it('leaves automated trades alone for a manual position, or an exit that did not happen', async () => {
    db.getOpenPosition.mockResolvedValue({ ...position, source: 'manual' });
    db.exitPositionById.mockResolvedValue({ ...position, exited: true });
    await exitPaperTrade('U1', 'p1', 95, { now: OPEN });

    db.getOpenPosition.mockResolvedValue({ ...position, source: 'auto' });
    db.exitPositionById.mockResolvedValue(null); // exited by another request meanwhile
    await exitPaperTrade('U1', 'p1', 95, { now: OPEN });
    await exitPaperTrade('U1', 'p1', 95, { now: CLOSED }); // refused

    expect(db.closeAutoTradesOfPosition).not.toHaveBeenCalled();
  });

  it('lets a live position exit while the market is closed', async () => {
    db.getOpenPosition.mockResolvedValue({ ...position, mode: 'live' });
    db.exitPositionById.mockResolvedValue(true);
    expect((await exitPaperTrade('U1', 'p1', 95, { now: CLOSED })).ok).toBe(true);
  });

  it('returns NOT_FOUND when another request exited it first', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    db.exitPositionById.mockResolvedValue(false);
    const result = await exitPaperTrade('U1', 'p1', 95, { now: OPEN });
    expect(result).toMatchObject({ ok: false, code: NOT_FOUND });
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
