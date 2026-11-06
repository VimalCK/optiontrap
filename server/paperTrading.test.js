import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  addPosition: vi.fn(),
  exitPositionById: vi.fn(),
  getOpenPosition: vi.fn(),
  closeAutoTradesOfPosition: vi.fn(),
}));

const db = await import('./db.js');
const { openPaperTrade, exitPaperTrade, NOT_FOUND } = await import('./paperTrading.js');
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

  it('exits an open position at the given price', async () => {
    db.getOpenPosition.mockResolvedValue(position);
    db.exitPositionById.mockResolvedValue(true);

    const result = await exitPaperTrade('U1', 'p1', '95.5', { now: OPEN });

    expect(result).toEqual({ ok: true, position: { ...position, exited: true, exitPrice: 95.5 } });
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
    db.getOpenPosition.mockResolvedValue({ ...position, source: 'auto' });
    db.exitPositionById.mockResolvedValue(true);

    expect((await exitPaperTrade('U1', 'p1', '95.5', { now: OPEN })).ok).toBe(true);
    expect(db.closeAutoTradesOfPosition).toHaveBeenCalledWith('U1', 'p1', 95.5, { ruleId: null, reason: 'Exited manually' });

    await exitPaperTrade('U1', 'p1', 90, { now: OPEN, exitReason: { ruleId: 'stop-loss', reason: 'Stop-loss hit' } });
    expect(db.closeAutoTradesOfPosition).toHaveBeenLastCalledWith('U1', 'p1', 90, { ruleId: 'stop-loss', reason: 'Stop-loss hit' });
  });

  it('leaves automated trades alone for a manual position, or an exit that did not happen', async () => {
    db.getOpenPosition.mockResolvedValue({ ...position, source: 'manual' });
    db.exitPositionById.mockResolvedValue(true);
    await exitPaperTrade('U1', 'p1', 95, { now: OPEN });

    db.getOpenPosition.mockResolvedValue({ ...position, source: 'auto' });
    db.exitPositionById.mockResolvedValue(false); // exited by another request meanwhile
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
