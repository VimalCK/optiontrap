import { describe, it, expect } from 'vitest';
import type { AutoTrade } from '@/services/automation';
import { closedPnl, eventSummary, sideTone, stageIsLive, stageTone, tradeReason, tradeStrategy } from './autoTradeView';

const at = '2026-11-06T07:00:29.000Z'; // Fri 12:30 IST
const selected = { stage: 'selected' as const, at, detail: { strategyId: 'option-analyzer-setups', reason: 'Wall Defense · score 62 · POP 54%' } };
const trade: AutoTrade = {
  id: 't1', horizon: 'intraday', kind: 'index-option', mode: 'paper', tradingsymbol: 'BANKNIFTY26NOV58000PE',
  instrumentToken: 1, side: 'SELL', quantity: 30, stage: 'executed', reason: null,
  entryPrice: 731.9, exitPrice: null, positionId: 'p1', createdAt: at, updatedAt: at,
  events: [selected, { stage: 'validated', at, detail: {} }, { stage: 'executed', at, detail: { entryPrice: 731.9, positionId: 'p1' } }],
};

describe('closedPnl', () => {
  it('is the trade\'s own P&L from entry to exit once closed', () => {
    expect(closedPnl({ ...trade, stage: 'closed', exitPrice: 700 })).toBeCloseTo(957); // sold 30 at 731.90, out at 700
    expect(closedPnl({ ...trade, stage: 'closed', side: 'BUY', exitPrice: 700 })).toBeCloseTo(-957);
  });

  it('has none while the trade is open or never filled', () => {
    expect(closedPnl(trade)).toBeNull();
    expect(closedPnl({ ...trade, stage: 'rejected', entryPrice: null })).toBeNull();
  });
});

describe('tones', () => {
  it('shows buys green and sells red', () => {
    expect(sideTone('BUY')).toBe('positive');
    expect(sideTone('SELL')).toBe('negative');
  });

  it('shows rejections red, trades in progress in the accent, and only an open position as live', () => {
    expect(stageTone('rejected')).toBe('negative');
    expect(stageTone('executed')).toBe('accent');
    expect(stageTone('closed')).toBe('neutral');
    expect(stageIsLive('executed')).toBe(true);
    expect(stageIsLive('closed')).toBe(false);
  });
});

describe('tradeReason and tradeStrategy', () => {
  it('gives why the strategy picked an open trade, and which strategy', () => {
    expect(tradeReason(trade)).toBe('Wall Defense · score 62 · POP 54%');
    expect(tradeStrategy(trade)).toBe('Option Analyzer setups');
  });

  it('gives why a trade was rejected or closed over why it was picked', () => {
    expect(tradeReason({ ...trade, stage: 'rejected', reason: 'Sell Index option is off' })).toBe('Sell Index option is off');
  });

  it('is empty, with no strategy, when nothing was recorded', () => {
    expect(tradeReason({ ...trade, events: [] })).toBe('');
    expect(tradeStrategy({ ...trade, events: [] })).toBeNull();
  });
});

describe('eventSummary', () => {
  it('says each stage in plain words, not the stored JSON', () => {
    expect(eventSummary(selected)).toBe('Option Analyzer setups · Wall Defense · score 62 · POP 54%');
    expect(eventSummary({ stage: 'validated', at, detail: {} })).toBe('Passed the General settings and every active entry rule');
    expect(eventSummary({ stage: 'executed', at, detail: { entryPrice: 731.9 } })).toBe('Opened a paper position at ₹731.90');
    expect(eventSummary({ stage: 'closed', at, detail: { exitPrice: 700, ruleId: 'stop-loss', reason: 'Stop-loss hit' } }))
      .toBe('Closed at ₹700.00 · Stop-loss hit');
  });

  it('names the entry rule behind a rejection, and keeps a General setting\'s reason as it is', () => {
    expect(eventSummary({ stage: 'rejected', at, detail: { ruleId: 'max-open-positions', reason: '10 open already' } }))
      .toBe('Max open automated positions · 10 open already');
    expect(eventSummary({ stage: 'rejected', at, detail: { ruleId: null, reason: 'Sell Index option is off' } })).toBe('Sell Index option is off');
  });

  it('still says something for an event with no detail', () => {
    expect(eventSummary({ stage: 'selected', at, detail: null })).toBe('Selected');
    expect(eventSummary({ stage: 'executed', at, detail: null })).toBe('Opened a paper position');
  });
});
