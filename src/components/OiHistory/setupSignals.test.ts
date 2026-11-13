import { describe, it, expect } from 'vitest';
import type { OiCellData, OiHistoryRow, OiTableRow, TradeSignalRow } from './types';
import type { StrikeChartData } from './strikeChart';
import { OptionType, Side } from '../../../shared/tradeEnums.js';
import { Bias, OiFlow, RolloverPattern, SellingSetup, TradeSetupStatus } from '../../../shared/analysisEnums.js';
import { SignalOutcome } from '../../../shared/appEnums.js';
import { atmStrikeOn, setupOrder, setupTrade, signalToLog, summarizeSignalPerformance } from './setupSignals';

const noSell = { type: SellingSetup.NoSell, status: TradeSetupStatus.Avoid };
const noBuy = { direction: Bias.Neutral, status: TradeSetupStatus.Avoid };

describe('setupTrade', () => {
  it('takes a live selling setup first', () => {
    const chart = { sellingSetup: { type: SellingSetup.PutSell, status: TradeSetupStatus.Watch }, tradeSetup: { direction: Bias.Bullish, status: TradeSetupStatus.Confirmed } };
    expect(setupTrade(chart as never)).toEqual({ action: Side.SELL, optionType: OptionType.PE, status: TradeSetupStatus.Watch });
  });

  it('else a live buying setup, CE when bullish and PE when bearish', () => {
    expect(setupTrade({ sellingSetup: noSell, tradeSetup: { direction: Bias.Bearish, status: TradeSetupStatus.Confirmed } } as never))
      .toEqual({ action: Side.BUY, optionType: OptionType.PE, status: TradeSetupStatus.Confirmed });
  });

  it('is null when both say avoid', () => {
    expect(setupTrade({ sellingSetup: noSell, tradeSetup: noBuy } as never)).toBeNull();
  });
});

const row = (changes: Partial<OiHistoryRow>): OiHistoryRow => ({
  date: '2026-11-12', instrumentToken: 1, tradingsymbol: 'X', strike: 24000, optionType: OptionType.CE, expiry: '2026-11-18',
  open: 0, high: 0, low: 0, close: 100, volume: 0, oi: 0, spotClose: 24040, ...changes,
});

describe('atmStrikeOn', () => {
  it("is the strike nearest that date's spot", () => {
    const rows = [row({ strike: 23900 }), row({ strike: 24000 }), row({ strike: 24000, date: '2026-11-11', spotClose: 23900 })];
    expect(atmStrikeOn(rows, '2026-11-12')).toBe(24000);
    expect(atmStrikeOn(rows, '2026-11-01')).toBeNull();
  });
});

describe('signalToLog', () => {
  const expiry = '2026-11-18';
  const cell = { ceToken: 7, peToken: 8 } as OiCellData;
  const chart = {
    dates: ['2026-11-11', '2026-11-12'],
    dateMap: new Map([['2026-11-12', new Map([[expiry, { ceClose: 95, peClose: 80 }]])]]),
    sellingSetup: { type: SellingSetup.CallSell, status: TradeSetupStatus.Confirmed },
    tradeSetup: noBuy,
    premiumDecay: { nearestExpiry: expiry, ce: { decayPct: -12, score: 3, daysToExpiry: 4, latestVolume: 900 }, pe: null },
    optionMomentum: { ce: null, pe: null },
    priceTrend: { endPrice: 24040 },
    biasSummary: { bias: Bias.Bearish },
  } as unknown as StrikeChartData;
  const tableRows = [{ strike: 24000, cePattern: RolloverPattern.ShortBuildup, pePattern: RolloverPattern.None, cells: new Map([[expiry, cell]]) }] as unknown as OiTableRow[];
  const input = {
    scrip: 'NIFTY', strike: 24000, chart, rows: [row({})], tableDate: '2026-11-12', tableRows,
    flowByToken: new Map([[7, { flow: OiFlow.WritersAdding }]]) as never,
    fairToday: { byToken: new Map(), byExpiry: new Map() },
  };

  it("records the ATM strike's live setup once per scrip, date, expiry, strike, type and side", () => {
    const signal = signalToLog(input)!;
    expect(signal.key).toBe('NIFTY|2026-11-12|2026-11-18|24000|CE|SELL');
    expect(signal.body).toMatchObject({ signalDate: '2026-11-12', expiry, action: Side.SELL, optionType: OptionType.CE, entryPremium: 95, spotPrice: 24040 });
    expect((signal.body.details as Record<string, unknown>)).toMatchObject({
      strikePattern: RolloverPattern.ShortBuildup,
      ivFlow: OiFlow.WritersAdding,
      decay: { decayPct: -12, score: 3, daysToExpiry: 4, latestVolume: 900 },
    });
  });

  it("leaves out the table's pattern and flow when it shows another date", () => {
    const details = signalToLog({ ...input, tableDate: '2026-11-11' })!.body.details as Record<string, unknown>;
    expect(details).not.toHaveProperty('strikePattern');
    expect(details).not.toHaveProperty('ivFlow');
  });

  it("records nothing off the day's ATM strike, without a premium, or once the expiry has passed", () => {
    expect(signalToLog({ ...input, strike: 24100 })).toBeNull();
    expect(signalToLog({ ...input, chart: { ...chart, dateMap: new Map() } })).toBeNull();
    expect(signalToLog({ ...input, chart: { ...chart, premiumDecay: { ...chart.premiumDecay, nearestExpiry: '2026-11-11' } } })).toBeNull();
  });

  it('records nothing without a live setup', () => {
    expect(signalToLog({ ...input, chart: { ...chart, sellingSetup: noSell } as unknown as StrikeChartData })).toBeNull();
  });
});

describe('summarizeSignalPerformance', () => {
  const signal = (changes: Partial<TradeSignalRow>) => ({ action: Side.BUY, outcome_status: null, outcome_return: null, max_favorable_return: null, max_adverse_return: null, ...changes }) as TradeSignalRow;

  it('scores the closed signals and averages the open ones', () => {
    const summary = summarizeSignalPerformance([
      signal({ outcome_status: SignalOutcome.Profit, outcome_return: 20, max_favorable_return: 30, max_adverse_return: -5 }),
      signal({ outcome_status: SignalOutcome.Loss, outcome_return: -10, action: Side.SELL }),
      signal({ outcome_status: SignalOutcome.Open, outcome_return: 4 }),
      signal({ outcome_status: null }),
    ]);
    expect(summary).toMatchObject({
      total: 4, open: 2, averageOpenReturn: 4, evaluated: 2, wins: 1, winRate: 50, averageReturn: 5,
      averageMaxFavorable: 30, averageMaxAdverse: -5, averageWin: 20, averageLoss: -10, profitFactor: 2,
      buyEvaluated: 1, buyWinRate: 100, sellEvaluated: 1, sellWinRate: 0,
    });
  });

  it('has an infinite profit factor with no losses, and no rates without scored signals', () => {
    expect(summarizeSignalPerformance([signal({ outcome_status: SignalOutcome.Profit, outcome_return: 5 })]).profitFactor).toBe(Infinity);
    expect(summarizeSignalPerformance([])).toMatchObject({ winRate: null, averageReturn: null, profitFactor: null });
  });
});

describe('setupOrder', () => {
  const levels = { resistanceStrike: 24200, supportStrike: 23800, maxOiStrike: 24000 };
  const cells = (ce: Partial<OiCellData>) => new Map([['2026-11-18', { ceToken: undefined, ceClose: 0, peToken: undefined, peClose: 0 } as OiCellData], ['2026-11-25', ce as OiCellData]]);
  const table = [{ strike: 24200, cells: cells({ ceToken: 5, ceClose: 40 }) }] as unknown as OiTableRow[];
  const chart = (changes: object) => ({ tradeSetup: noBuy, sellingSetup: noSell, tradeLevels: levels, ...changes }) as never;
  const expiries = ['2026-11-18', '2026-11-25'];

  it("buys CE at the resistance on the first expiry with a price there", () => {
    const order = setupOrder(Side.BUY, chart({ tradeSetup: { direction: Bias.Bullish } }), 24000, table, expiries);
    expect(order).toMatchObject({ ok: true, optionType: OptionType.CE, strike: 24200, expiry: '2026-11-25' });
  });

  it('says why when there is nothing to trade', () => {
    expect(setupOrder(Side.SELL, chart({}), 24000, table, expiries)).toEqual({ ok: false, message: 'No single-leg strike for this setup' });
    expect(setupOrder(Side.SELL, chart({ sellingSetup: { type: SellingSetup.PutSell } }), 24000, table, expiries)).toEqual({ ok: false, message: 'Strike 23800 not in table' });
    expect(setupOrder(Side.BUY, chart({ tradeSetup: { direction: Bias.Bullish } }), 24000, table, ['2026-11-18'])).toEqual({ ok: false, message: 'No CE data at strike 24200' });
  });
});
