import { describe, it, expect } from 'vitest';
import {
  MARKET_CLOSED_MESSAGE,
  PAPER_TRADE_RULES,
  RULE_CODES,
  checkPaperTrade,
  normalizeTradeInput,
} from './paperTradeRules.js';

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
};

const open = (input, now = OPEN) => checkPaperTrade('open', { trade: normalizeTradeInput(input), now });
const exit = (position, exitPrice, now = OPEN) => checkPaperTrade('exit', { position, exitPrice, now });
const rulesHit = (result) => (result.ok ? [] : result.violations.map((v) => v.rule));

describe('normalizeTradeInput', () => {
  it('parses the numeric fields', () => {
    const trade = normalizeTradeInput(validInput);
    expect(trade).toMatchObject({ instrumentToken: 12345, strike: 24000, quantity: 75, entryPrice: 101.5 });
  });

  it('defaults mode to paper and keeps an explicit mode', () => {
    expect(normalizeTradeInput(validInput).mode).toBe('paper');
    expect(normalizeTradeInput({ ...validInput, mode: 'live' }).mode).toBe('live');
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

  it.each(['tradingsymbol', 'instrumentToken', 'strike', 'optionType', 'side', 'quantity', 'entryPrice', 'expiry'])(
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

describe('exit-price-given rule', () => {
  const position = { id: 'p1', mode: 'paper' };

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
    expect(rulesHit(exit({ mode: 'paper' }, 95, CLOSED))).toEqual(['market-open']);
    expect(rulesHit(exit({ mode: null }, 95, CLOSED))).toEqual(['market-open']); // missing mode is paper
    expect(exit({ mode: 'paper' }, 95, OPEN).ok).toBe(true);
  });

  it('never blocks live trades, which go through Kite', () => {
    expect(open({ ...validInput, mode: 'live' }, CLOSED).ok).toBe(true);
    expect(exit({ mode: 'live' }, 95, ist('2026-10-17', '11:00')).ok).toBe(true);
  });
});

describe('checkPaperTrade', () => {
  it('reports every failing rule, in list order', () => {
    expect(rulesHit(open({}, CLOSED))).toEqual(['required-fields', 'market-open']);
    expect(rulesHit(exit({ mode: 'paper' }, undefined, CLOSED))).toEqual(['exit-price-given', 'market-open']);
  });

  it('runs only the rules for the action', () => {
    // An open is never refused for a missing exit price, nor an exit for missing trade fields.
    expect(rulesHit(open(validInput))).toEqual([]);
    expect(rulesHit(exit({ mode: 'paper' }, 95))).toEqual([]);
  });

  it('rejects an unknown action', () => {
    expect(() => checkPaperTrade('modify', {})).toThrow('Unknown paper trade action: modify');
  });

  it('accepts a custom rule list', () => {
    const maxQuantity = {
      id: 'max-quantity',
      appliesTo: ['open'],
      code: 'TOO_BIG',
      check: ({ trade }) => (trade.quantity > 100 ? 'Too many lots' : null),
    };
    const rules = [...PAPER_TRADE_RULES, maxQuantity];
    const ctx = (quantity) => ({ trade: normalizeTradeInput({ ...validInput, quantity }), now: OPEN });

    expect(checkPaperTrade('open', ctx(75), rules)).toEqual({ ok: true });
    expect(checkPaperTrade('open', ctx(150), rules)).toEqual({
      ok: false,
      violations: [{ rule: 'max-quantity', code: 'TOO_BIG', message: 'Too many lots' }],
    });
  });

  it('gives every built-in rule a unique id, a code and at least one action', () => {
    const ids = PAPER_TRADE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of PAPER_TRADE_RULES) {
      expect(Object.values(RULE_CODES)).toContain(rule.code);
      expect(rule.appliesTo.length).toBeGreaterThan(0);
    }
  });
});
