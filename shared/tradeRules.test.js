import { describe, it, expect } from 'vitest';
import {
  INTRADAY_CLOSED_MESSAGE,
  MARKET_CLOSED_MESSAGE,
  TRADE_RULES,
  RULE_CODES,
  checkTrade,
  normalizeTradeInput,
} from './tradeRules.js';
import { Horizon } from './tradeEnums.js';

/** The instant at `hhmm` IST on `date` (IST is UTC+5:30). */
const ist = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((h * 60 + m) - 330) * 60000);
};

const TRADING_DAY = '2026-11-05'; // Thursday
const OPEN = ist(TRADING_DAY, '12:00');
const CLOSED = ist(TRADING_DAY, '20:00');

const validInput = {
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

const open = (input, now = OPEN) => checkTrade('Open', { trade: normalizeTradeInput(input), now });
const exit = (position, exitPrice, now = OPEN) => checkTrade('Exit', { position, exitPrice, now });
const rulesHit = (result) => (result.ok ? [] : result.violations.map((v) => v.rule));

describe('normalizeTradeInput', () => {
  it('parses the numeric fields', () => {
    const trade = normalizeTradeInput(validInput);
    expect(trade).toMatchObject({ instrumentToken: 12345, strike: 24000, quantity: 75, entryPrice: 101.5 });
  });

  it('defaults mode to paper and keeps an explicit mode', () => {
    expect(normalizeTradeInput(validInput).mode).toBe('Paper');
    expect(normalizeTradeInput({ ...validInput, mode: 'Live' }).mode).toBe('Live');
  });

  it('leaves missing values missing so the rules can report them', () => {
    const trade = normalizeTradeInput({});
    expect(trade.strike).toBeUndefined();
    expect(normalizeTradeInput({ strike: null }).strike).toBeNull();
    expect(normalizeTradeInput({ strike: '' }).strike).toBe('');
  });

  it('keeps a strike of 0 (a real number, not missing)', () => {
    expect(normalizeTradeInput({ strike: 0 }).strike).toBe(0);
  });

  it('copies only known fields', () => {
    expect(normalizeTradeInput({ ...validInput, userId: 'someone-else' })).not.toHaveProperty('userId');
  });
});

describe('required-fields rule', () => {
  it('passes a complete trade', () => {
    expect(open(validInput)).toEqual({ ok: true });
  });

  it.each(['tradingsymbol', 'instrumentToken', 'side', 'quantity', 'entryPrice'])(
    'refuses a trade without %s',
    (field) => {
      const { [field]: _omit, ...input } = validInput;
      const result = open(input);
      expect(result).toEqual({
        ok: false,
        violations: [{ rule: 'required-fields', code: RULE_CODES.INVALID_TRADE, message: 'Missing required fields' }],
      });
    },
  );

  it('refuses a non-numeric quantity', () => {
    expect(rulesHit(open({ ...validInput, quantity: 'abc' }))).toEqual(['required-fields']);
  });

  it('allows a strike of 0', () => {
    expect(open({ ...validInput, strike: 0 }).ok).toBe(true);
  });
});

describe('horizon-given rule', () => {
  it('takes an intraday or a positional trade', () => {
    expect(open(validInput)).toEqual({ ok: true });
    expect(open({ ...validInput, horizon: Horizon.Positional })).toEqual({ ok: true });
  });

  it('refuses a trade without a horizon, or with an unknown one, asking for one', () => {
    const refused = { ok: false, violations: [{ rule: 'horizon-given', code: 'INVALID_TRADE', message: 'Choose Intraday or Positional' }] };
    expect(open({ ...validInput, horizon: undefined })).toEqual(refused);
    expect(open({ ...validInput, horizon: 'long' })).toEqual(refused);
  });
});

describe('instrument-fields rule', () => {
  const stock = { tradingsymbol: 'RELIANCE', instrumentToken: '738561', instrumentType: 'EQ', side: 'BUY', quantity: '10', entryPrice: '1400', horizon: Horizon.Intraday };
  const future = { tradingsymbol: 'NIFTY26NOVFUT', instrumentToken: '13238786', instrumentType: 'FUT', side: 'SELL', quantity: '75', entryPrice: '24100', expiry: '2026-11-24', horizon: Horizon.Positional };
  const hit = (input) => (open(input).ok ? null : open(input).violations.find((v) => v.rule === 'instrument-fields')?.message);

  it('takes a trade that sends only optionType CE/PE as an option, as the option chain does', () => {
    expect(normalizeTradeInput(validInput)).toMatchObject({ instrumentType: 'CE', exchange: 'NFO' });
    expect(open(validInput)).toEqual({ ok: true });
  });

  it('accepts a stock with no strike, option type or expiry, on NSE by default', () => {
    expect(open(stock)).toEqual({ ok: true });
    expect(normalizeTradeInput(stock).exchange).toBe('NSE');
    expect(normalizeTradeInput({ ...stock, exchange: 'BSE' }).exchange).toBe('BSE');
  });

  it('accepts a future with an expiry, and refuses one without', () => {
    expect(open(future)).toEqual({ ok: true });
    expect(normalizeTradeInput(future).exchange).toBe('NFO');
    const { expiry: _omit, ...noExpiry } = future;
    expect(hit(noExpiry)).toBe('A future needs an expiry');
  });

  it.each(['strike', 'expiry'])('refuses an option without %s', (field) => {
    const { [field]: _omit, ...input } = validInput;
    expect(hit(input)).toBe('An option needs a strike and an expiry');
  });

  it('refuses an option whose optionType does not match its type', () => {
    expect(hit({ ...validInput, instrumentType: 'PE' })).toBe('optionType must match instrumentType for an option');
  });

  it('refuses a trade with no known instrument type', () => {
    const { optionType: _omit, ...input } = validInput;
    expect(hit(input)).toBe('instrumentType must be one of: CE, PE, FUT, EQ');
    expect(hit({ ...stock, instrumentType: 'CRYPTO' })).toBe('instrumentType must be one of: CE, PE, FUT, EQ');
  });
});

describe('exit-price-given rule', () => {
  const position = { id: 'p1', mode: 'Paper' };

  it('passes when an exit price is given, including 0', () => {
    expect(exit(position, 95)).toEqual({ ok: true });
    expect(exit(position, 0)).toEqual({ ok: true });
  });

  it.each([undefined, null])('refuses exitPrice %s', (price) => {
    expect(exit(position, price)).toEqual({
      ok: false,
      violations: [{ rule: 'exit-price-given', code: RULE_CODES.INVALID_TRADE, message: 'exitPrice is required' }],
    });
  });
});

describe('intraday-market-hours rule (placing an order)', () => {
  const place = (input, now) => checkTrade('Place', { trade: normalizeTradeInput(input), now });

  it('places an intraday order only while the market is open', () => {
    expect(place(validInput, OPEN)).toEqual({ ok: true });
    expect(place(validInput, CLOSED)).toEqual({ ok: false, violations: [{ rule: 'intraday-market-hours', code: 'MARKET_CLOSED', message: INTRADAY_CLOSED_MESSAGE }] });
  });

  it('places a positional order at any time, even on a weekend', () => {
    expect(place({ ...validInput, horizon: Horizon.Positional }, CLOSED)).toEqual({ ok: true });
    expect(place({ ...validInput, horizon: Horizon.Positional }, ist('2026-10-17', '11:00'))).toEqual({ ok: true }); // Saturday
  });

  it('still needs the order complete, with a horizon', () => {
    expect(place({ ...validInput, horizon: undefined }, OPEN).violations.map((v) => v.rule)).toEqual(['horizon-given']);
  });
});

describe('market-open rule', () => {
  it.each([
    ['at the open, 9:15', '09:15'],
    ['mid-session', '12:00'],
    ['at the close, 15:30', '15:30'],
  ])('allows a paper trade %s', (_label, time) => {
    expect(open(validInput, ist(TRADING_DAY, time)).ok).toBe(true);
  });

  it.each([
    ['in pre-open, 9:14', '09:14'],
    ['before pre-open, 8:00', '08:00'],
    ['just after the close, 15:31', '15:31'],
    ['in the evening', '20:00'],
    ['after midnight', '00:30'],
  ])('blocks a paper trade %s', (_label, time) => {
    expect(open(validInput, ist(TRADING_DAY, time))).toEqual({
      ok: false,
      violations: [{ rule: 'market-open', code: RULE_CODES.MARKET_CLOSED, message: MARKET_CLOSED_MESSAGE }],
    });
  });

  it('blocks paper trades all weekend, even in session hours', () => {
    expect(rulesHit(open(validInput, ist('2026-10-17', '11:00')))).toEqual(['market-open']); // Saturday
    expect(rulesHit(open(validInput, ist('2026-10-18', '11:00')))).toEqual(['market-open']); // Sunday
  });

  it('blocks paper trades on a weekday market holiday', () => {
    expect(rulesHit(open(validInput, ist('2026-01-26', '11:00')))).toEqual(['market-open']); // Republic Day
  });

  it('judges the time in IST, not the server’s zone', () => {
    // 05:00 UTC Thursday is 10:30 IST: open.
    expect(open(validInput, new Date('2026-11-05T05:00:00Z')).ok).toBe(true);
    // 23:00 UTC Thursday is 04:30 IST Friday: closed.
    expect(rulesHit(open(validInput, new Date('2026-11-05T23:00:00Z')))).toEqual(['market-open']);
  });

  it('applies to exits too, judged on the position’s mode', () => {
    expect(rulesHit(exit({ mode: 'Paper' }, 95, CLOSED))).toEqual(['market-open']);
    expect(rulesHit(exit({ mode: null }, 95, CLOSED))).toEqual(['market-open']); // missing mode is paper
    expect(exit({ mode: 'Paper' }, 95, OPEN).ok).toBe(true);
  });

  it('never blocks live trades, which go through Kite', () => {
    expect(open({ ...validInput, mode: 'Live' }, CLOSED).ok).toBe(true);
    expect(exit({ mode: 'Live' }, 95, ist('2026-10-17', '11:00')).ok).toBe(true);
  });
});

describe('checkTrade', () => {
  it('reports every failing rule, in list order', () => {
    expect(rulesHit(open({}, CLOSED))).toEqual(['required-fields', 'instrument-fields', 'horizon-given', 'market-open']);
    expect(rulesHit(exit({ mode: 'Paper' }, undefined, CLOSED))).toEqual(['exit-price-given', 'market-open']);
  });

  it('runs only the rules for the action', () => {
    // An open is never refused for a missing exit price, nor an exit for missing trade fields.
    expect(rulesHit(open(validInput))).toEqual([]);
    expect(rulesHit(exit({ mode: 'Paper' }, 95))).toEqual([]);
  });

  it("checks the engine's square-off after the close for an exit price only, not for the market being open", () => {
    const squareOff = (exitPrice) => checkTrade('SquareOff', { position: { id: 'p1', mode: 'Paper' }, exitPrice, now: CLOSED });
    expect(squareOff(95)).toEqual({ ok: true });
    expect(rulesHit(squareOff(null))).toEqual(['exit-price-given']);
    // An ordinary exit at the same moment is refused.
    expect(rulesHit(exit({ mode: 'Paper' }, 95, CLOSED))).toEqual(['market-open']);
  });

  it('rejects an unknown action', () => {
    expect(() => checkTrade('modify', {})).toThrow('Unknown trade action: modify');
  });

  it('accepts a custom rule list', () => {
    const maxQuantity = {
      id: 'max-quantity',
      appliesTo: ['Open'],
      code: 'TOO_BIG',
      check: ({ trade }) => (trade.quantity > 100 ? 'Too many lots' : null),
    };
    const rules = [...TRADE_RULES, maxQuantity];
    const ctx = (quantity) => ({ trade: normalizeTradeInput({ ...validInput, quantity }), now: OPEN });

    expect(checkTrade('Open', ctx(75), rules)).toEqual({ ok: true });
    expect(checkTrade('Open', ctx(150), rules)).toEqual({
      ok: false,
      violations: [{ rule: 'max-quantity', code: 'TOO_BIG', message: 'Too many lots' }],
    });
  });

  it('gives every built-in rule a unique id, a code and at least one action', () => {
    const ids = TRADE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of TRADE_RULES) {
      expect(Object.values(RULE_CODES)).toContain(rule.code);
      expect(rule.appliesTo.length).toBeGreaterThan(0);
    }
  });
});
