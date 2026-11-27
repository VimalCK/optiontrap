import { describe, it, expect } from 'vitest';
import { GENERAL_ENTRY_RULES, GENERAL_EXIT_RULES, GENERAL_RULES } from './index.js';
import { ENTRY_RULES } from '../entryRules/index.js';
import { EXIT_RULES } from '../exitRules/index.js';
import { defaultRuleSettings } from '../rules/ruleSettings.js';

const trade = { instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', side: 'SELL', quantity: 225, lotSize: 75 };
const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const ctx = (extra = {}) => ({ now: NOON, openAutoPositions: [], waitingAutoOrders: [], todayAutoPnl: 0, todayAutoExits: [], ...extra });
const check = (id, params, extraCtx = {}, t = trade) => GENERAL_RULES.find((r) => r.id === id).check(t, ctx(extraCtx), params);

describe('the general rule lists', () => {
  it('are max open positions (entry) and max loss per day (exit)', () => {
    expect(GENERAL_ENTRY_RULES.map((r) => r.id)).toEqual(['max-open-positions']);
    expect(GENERAL_EXIT_RULES.map((r) => r.id)).toEqual(['max-daily-loss']);
    expect(GENERAL_RULES.map((r) => r.id)).toEqual(['max-open-positions', 'max-daily-loss']);
  });

  it("share no id with a strategy's own rules, and start inactive with nothing set", () => {
    const strategyIds = new Set([...ENTRY_RULES, ...EXIT_RULES].map((r) => r.id));
    expect(GENERAL_RULES.some((r) => strategyIds.has(r.id))).toBe(false);
    expect(defaultRuleSettings(GENERAL_RULES)).toEqual({
      'max-open-positions': { active: false, params: { max: null } },
      'max-daily-loss': { active: false, params: { amount: null } },
    });
  });
});

describe('max-open-positions', () => {
  const open = [{ instrumentToken: 1 }, { instrumentToken: 2 }];

  it('rejects a trade that would open one position too many', () => {
    expect(check('max-open-positions', { max: 3 }, { openAutoPositions: open })).toBeNull();
    expect(check('max-open-positions', { max: 2 }, { openAutoPositions: open }))
      .toBe('2 automated positions already open or waiting to fill, the most allowed is 2');
  });

  it('allows a trade in an instrument already held, by any strategy, since it adds to that position', () => {
    expect(check('max-open-positions', { max: 2 }, { openAutoPositions: open }, { ...trade, instrumentToken: 2 })).toBeNull();
  });

  it('counts each instrument once, however many strategies hold it', () => {
    const twoStrategies = [{ instrumentToken: 1 }, { instrumentToken: 1 }];
    expect(check('max-open-positions', { max: 2 }, { openAutoPositions: twoStrategies })).toBeNull();
  });

  it('counts a waiting automated limit order as the position it will open, once per instrument', () => {
    const waiting = { openAutoPositions: [{ instrumentToken: 1 }], waitingAutoOrders: [{ instrumentToken: 2 }] };
    expect(check('max-open-positions', { max: 2 }, waiting)).toBe('2 automated positions already open or waiting to fill, the most allowed is 2');
    expect(check('max-open-positions', { max: 2 }, { ...waiting, waitingAutoOrders: [{ instrumentToken: 1 }] })).toBeNull(); // will merge into the open one
  });
});

describe('max-daily-loss', () => {
  const position = (gain) => ({ instrumentToken: 101, tradingsymbol: 'NIFTY26NOV24000PE', gain, bestGain: gain, pnl: gain * 75 });

  it("fires once today's automated P&L reaches the loss, not before", () => {
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: -4999.99 }, position(0))).toBeNull();
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: 2000 }, position(0))).toBeNull();
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: -5000 }, position(0)))
      .toBe("Max loss per day hit: today's automated P&L ₹-5000.00, limit ₹5000");
  });

  it('exits a winning position too, since the limit is on the whole day', () => {
    expect(check('max-daily-loss', { amount: 5000 }, { todayAutoPnl: -5500 }, position(30))).not.toBeNull();
  });

  it('blocks entry orders while it fires', () => {
    expect(GENERAL_EXIT_RULES.find((r) => r.id === 'max-daily-loss').blocksEntryOrders).toBe(true);
  });
});
