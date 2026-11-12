import { describe, expect, it } from 'vitest';
import {
  Exchange,
  HORIZONS,
  Horizon,
  InstrumentType,
  OptionType,
  Segment,
  Side,
  TradingMode,
  exchangeFor,
  horizonLabel,
  isHorizon,
  isOptionType,
  isSide,
  isTradingMode,
  oppositeSide,
  segmentOf,
  sideLabel,
} from './tradeEnums.js';

describe('tradeEnums', () => {
  it('keeps the stored text values', () => {
    expect([Side.BUY, Side.SELL]).toEqual(['BUY', 'SELL']);
    expect(Object.values(InstrumentType)).toEqual(['CE', 'PE', 'FUT', 'EQ']);
    expect([TradingMode.Paper, TradingMode.Live]).toEqual(['Paper', 'Live']);
  });

  it('stores horizons as text and labels them', () => {
    expect([Horizon.Intraday, Horizon.Positional]).toEqual(['Intraday', 'Positional']);
    expect(HORIZONS.map((h) => h.id)).toEqual(['Intraday', 'Positional']);
    expect(isHorizon('Positional')).toBe(true);
    expect(isHorizon(1)).toBe(false);
    expect(isHorizon('1')).toBe(false);
    expect(horizonLabel(Horizon.Positional)).toBe('Positional');
    expect(horizonLabel('weekly')).toBe('weekly');
  });

  it('closes a trade on the opposite side and labels sides', () => {
    expect(oppositeSide(Side.BUY)).toBe(Side.SELL);
    expect(oppositeSide(Side.SELL)).toBe(Side.BUY);
    expect(sideLabel(Side.SELL)).toBe('Sell');
    expect(sideLabel('HOLD')).toBe('HOLD');
  });

  it('recognises only its own values', () => {
    expect(isSide(Side.BUY)).toBe(true);
    expect(isSide('buy')).toBe(false);
    expect(isOptionType(OptionType.PE)).toBe(true);
    expect(isOptionType(InstrumentType.FUT)).toBe(false);
    expect(isOptionType(undefined)).toBe(false);
    expect(isTradingMode(TradingMode.Live)).toBe(true);
    expect(isTradingMode('all')).toBe(false);
  });

  it('puts stocks on NSE and derivatives on NFO', () => {
    expect(exchangeFor(InstrumentType.EQ)).toBe(Exchange.NSE);
    expect(exchangeFor(InstrumentType.CE)).toBe(Exchange.NFO);
    expect(exchangeFor(InstrumentType.FUT)).toBe(Exchange.NFO);
  });

  it('maps instrument types to journal segments', () => {
    expect(segmentOf(InstrumentType.PE)).toBe(Segment.Options);
    expect(segmentOf(InstrumentType.FUT)).toBe(Segment.Futures);
    expect(segmentOf(InstrumentType.EQ)).toBe(Segment.Stocks);
  });
});
