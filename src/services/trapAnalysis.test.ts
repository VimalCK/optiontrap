import { describe, it, expect } from 'vitest';
import { analyzeTrap, buildTrapContext, trapPositionOf } from './trapAnalysis';
import type { OptionChainRow, OptionInstrument } from './optionChain';
import { OptionType, Side, type OptionTypeId } from '../../shared/tradeEnums.js';
import { TrapVerdict } from '../../shared/analysisEnums.js';

const STRIKES = [24800, 24900, 25000, 25100, 25200];
const tokenOf = (strike: number, type: OptionTypeId) => strike * 10 + (type === OptionType.CE ? 1 : 2);
const option = (strike: number, type: OptionTypeId): OptionInstrument => ({
  instrumentToken: tokenOf(strike, type), exchangeToken: 0, tradingsymbol: '', name: '', expiry: '2026-11-24', strike, instrumentType: type, lotSize: 65,
});
const chain: OptionChainRow[] = STRIKES.map((strike) => ({ strike, ce: option(strike, OptionType.CE), pe: option(strike, OptionType.PE) }));

/** Every option at 1000 OI and ₹100, except the 25000 put, which moved as given since the previous day. */
function analyzePut(side: typeof Side.BUY | typeof Side.SELL, putOi: number, putPrice: number) {
  const oi = new Map(chain.flatMap((row) => [[tokenOf(row.strike, OptionType.CE), 1000], [tokenOf(row.strike, OptionType.PE), 1000]] as [number, number][]));
  const prevOi = new Map(oi);
  const prices = new Map([...oi.keys()].map((token) => [token, 100] as [number, number]));
  const closes = new Map(prices);
  oi.set(tokenOf(25000, OptionType.PE), putOi);
  prices.set(tokenOf(25000, OptionType.PE), putPrice);
  const ctx = buildTrapContext(chain, oi, 25000);
  // 10 days to expiry: no time pressure points. Max pain is at the strike, so it adds none either.
  return analyzeTrap(trapPositionOf(side, OptionType.PE), 25000, 25000, chain, oi, prevOi, closes, prices, 10, ctx);
}

describe('analyzeTrap on puts', () => {
  it('warns a put buyer when the put falls (short buildup), and backs them when it rises (long buildup)', () => {
    const falling = analyzePut(Side.BUY, 1200, 80);
    expect(falling.trapScore).toBe(2);
    expect(falling.verdict).toBe(TrapVerdict.Caution);

    const rising = analyzePut(Side.BUY, 1200, 120);
    expect(rising.trapScore).toBe(0);
    expect(rising.reasons).toEqual(['Long Buildup — supportive for your long put position']);
  });

  it('warns a put seller when put buyers add as the put rises, not when writers add as it falls', () => {
    const buyersAdding = analyzePut(Side.SELL, 1200, 120);
    expect(buyersAdding.trapScore).toBe(2);
    expect(buyersAdding.reasons[0]).toContain('Long Buildup at this strike');

    const writersAdding = analyzePut(Side.SELL, 1200, 80);
    expect(writersAdding.trapScore).toBe(0);
    expect(writersAdding.verdict).toBe(TrapVerdict.Safe);
  });
});
