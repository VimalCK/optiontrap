import { describe, it, expect } from 'vitest';
import type { AutoTrade } from '@/services/automation';
import { closedPnl, eventSummary, horizonLabel, sideTone, stageIsLive, stageTone, stepTone } from './autoTradeView';

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

  it('shows every lifecycle step green in the timeline, and only a rejection red', () => {
    expect(['selected', 'validated', 'executed', 'closed'].map((s) => stepTone(s as AutoTrade['stage']))).toEqual(['positive', 'positive', 'positive', 'positive']);
    expect(stepTone('rejected')).toBe('negative');
  });
});

describe('horizonLabel', () => {
  it('names how long the trade is held', () => {
    expect(horizonLabel('intraday')).toBe('Intraday');
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

  it('gives why a validated trade could not be placed', () => {
    expect(eventSummary({ stage: 'rejected', at, detail: { ruleId: null, reason: 'Market is closed' } })).toBe('Market is closed');
  });

  it('still says something for an event with no detail', () => {
    expect(eventSummary({ stage: 'selected', at, detail: null })).toBe('Selected');
    expect(eventSummary({ stage: 'executed', at, detail: null })).toBe('Opened a paper position');
  });
});
