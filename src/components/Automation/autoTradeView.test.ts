import { describe, it, expect } from 'vitest';
import type { AutoTrade } from '@/services/automation';
import { TEST_STRATEGIES } from '@/services/strategies.fixture';
import { closedPnl, eventSummary, horizonLabel, sideTone, stageIsLive, stageTone, stepTone, tradesByDay } from './autoTradeView';
import { Horizon } from '../../../shared/tradeEnums.js';

const at = '2026-11-06T07:00:29.000Z'; // Fri 12:30 IST
const selected = { stage: 'Selected' as const, at, detail: { strategyId: 'option-analyzer-setups', reason: 'Wall Defense · score 62 · POP 54%' } };
const trade: AutoTrade = {
  id: 't1', horizon: Horizon.Intraday, kind: 'IndexOption', mode: 'Paper', tradingsymbol: 'BANKNIFTY26NOV58000PE',
  instrumentToken: 1, side: 'SELL', quantity: 30, stage: 'Executed', reason: null,
  entryPrice: 731.9, exitPrice: null, charges: null, positionId: 'p1', createdAt: at, updatedAt: at,
  events: [selected, { stage: 'Validated', at, detail: {} }, { stage: 'Executed', at, detail: { entryPrice: 731.9, positionId: 'p1' } }],
};

describe('closedPnl', () => {
  it('is the trade\'s own P&L from entry to exit once closed', () => {
    expect(closedPnl({ ...trade, stage: 'Closed', exitPrice: 700 })).toBeCloseTo(957); // sold 30 at 731.90, out at 700
    expect(closedPnl({ ...trade, stage: 'Closed', side: 'BUY', exitPrice: 700 })).toBeCloseTo(-957);
    expect(closedPnl({ ...trade, stage: 'Closed', exitPrice: 700, charges: 57.25 })).toBeCloseTo(899.75); // after its charges
  });

  it('has none while the trade is open or never filled', () => {
    expect(closedPnl(trade)).toBeNull();
    expect(closedPnl({ ...trade, stage: 'Rejected', entryPrice: null })).toBeNull();
  });
});

describe('tradesByDay', () => {
  it('groups by the IST day, in the order given, adding up only closed P&L', () => {
    const made = (createdAt: string, changes: Partial<AutoTrade> = {}): AutoTrade => ({ ...trade, createdAt, ...changes });
    const days = tradesByDay([
      made('2026-11-05T19:00:00Z', { id: 'a', stage: 'Closed', exitPrice: 700 }), // Fri 6 Nov 00:30 IST
      made('2026-11-05T09:00:00Z', { id: 'b', stage: 'Closed', exitPrice: 700, charges: 57.25 }), // Thu 5 Nov 14:30 IST
      made('2026-11-05T04:00:00Z', { id: 'c' }), // Thu 5 Nov 09:30 IST, still open
    ]);
    expect(days.map((d) => [d.day, d.trades.map((t) => t.id)])).toEqual([['2026-11-06', ['a']], ['2026-11-05', ['b', 'c']]]);
    expect(days[0].pnl).toBeCloseTo(957);
    expect(days[1].pnl).toBeCloseTo(899.75);
  });

  it('has no P&L for a day with nothing closed', () => {
    expect(tradesByDay([trade])[0].pnl).toBeNull();
  });
});

describe('tones', () => {
  it('shows buys green and sells red', () => {
    expect(sideTone('BUY')).toBe('positive');
    expect(sideTone('SELL')).toBe('negative');
  });

  it('shows rejections red, trades in progress in the accent, and only an open position as live', () => {
    expect(stageTone('Rejected')).toBe('negative');
    expect(stageTone('Executed')).toBe('accent');
    expect(stageTone('Closed')).toBe('neutral');
    expect(stageIsLive('Executed')).toBe(true);
    expect(stageIsLive('Closed')).toBe(false);
  });

  it('shows every lifecycle step green in the timeline, and only a rejection red', () => {
    expect(['Selected', 'Validated', 'Executed', 'Closed'].map((s) => stepTone(s as AutoTrade['stage']))).toEqual(['positive', 'positive', 'positive', 'positive']);
    expect(stepTone('Rejected')).toBe('negative');
  });
});

describe('horizonLabel', () => {
  it('names how long the trade is held', () => {
    expect(horizonLabel(Horizon.Intraday)).toBe('Intraday');
  });
});

describe('eventSummary', () => {
  it('says each stage in plain words, not the stored JSON', () => {
    expect(eventSummary(selected, TEST_STRATEGIES)).toBe('Option Analyzer setups · Wall Defense · score 62 · POP 54%');
    expect(eventSummary({ stage: 'Validated', at, detail: {} }, TEST_STRATEGIES)).toBe('Passed the General settings and every active entry rule');
    expect(eventSummary({ stage: 'Executed', at, detail: { entryPrice: 731.9 } }, TEST_STRATEGIES)).toBe('Opened a paper position at ₹731.90');
    expect(eventSummary({ stage: 'Closed', at, detail: { exitPrice: 700, ruleId: 'stop-loss', reason: 'Stop-loss hit' } }, TEST_STRATEGIES))
      .toBe('Closed at ₹700.00 · Stop-loss hit');
  });

  it('gives why a validated trade could not be placed', () => {
    expect(eventSummary({ stage: 'Rejected', at, detail: { ruleId: null, reason: 'Market is closed' } }, TEST_STRATEGIES)).toBe('Market is closed');
  });

  it('still says something for an event with no detail', () => {
    expect(eventSummary({ stage: 'Selected', at, detail: null }, TEST_STRATEGIES)).toBe('Selected');
    expect(eventSummary({ stage: 'Executed', at, detail: null }, TEST_STRATEGIES)).toBe('Opened a paper position');
  });
});
