import { describe, it, expect } from 'vitest';
import { computeFairValues, fitSmile, realizedVol, volVerdict, describeFair, type FairInput } from './fairValue';
import { bsPrice, marketCloseIST, yearsToExpiry, RISK_FREE_RATE } from './oiFlow';

const asOf = marketCloseIST('2026-10-26');
const expiry = '2026-11-03';
const spot = 24000;
const t = yearsToExpiry(asOf, expiry);
const forward = spot * Math.exp(RISK_FREE_RATE * t);
/** A typical index smile: higher IV on the put side. */
const smile = (strike: number) => {
  const k = Math.log(strike / forward);
  return 0.13 - 0.15 * k + 1.5 * k * k;
};

function chain(overrides: Record<string, number> = {}): FairInput[] {
  const inputs: FairInput[] = [];
  let token = 1;
  for (let strike = 23200; strike <= 24800; strike += 100) {
    for (const optionType of ['CE', 'PE'] as const) {
      const key = `${strike}${optionType}`;
      const iv = overrides[key] ?? smile(strike);
      inputs.push({ token: token++, optionType, strike, expiry, price: bsPrice(optionType, spot, strike, t, iv), spot, asOf, volume: 1000 });
    }
  }
  return inputs;
}

const tokenOf = (inputs: FairInput[], strike: number, type: 'CE' | 'PE') =>
  inputs.find((i) => i.strike === strike && i.optionType === type)!.token;

describe('fitSmile', () => {
  it('recovers a quadratic curve and refuses to extrapolate', () => {
    const points = [-0.04, -0.02, 0, 0.02, 0.04].map((k) => ({ k, iv: 0.13 - 0.15 * k + 1.5 * k * k }));
    const fit = fitSmile(points)!;
    expect(fit(0.01)).toBeCloseTo(0.13 - 0.0015 + 0.00015, 6);
    expect(fit(0.08)).toBeNull();
  });

  it('needs at least five points', () => {
    expect(fitSmile([{ k: 0, iv: 0.1 }, { k: 0.01, iv: 0.1 }])).toBeNull();
  });
});

describe('computeFairValues', () => {
  it('marks options on the curve as fair, including skewed OTM puts', () => {
    const inputs = chain();
    const { byToken } = computeFairValues(inputs);
    const otmPut = byToken.get(tokenOf(inputs, 23400, 'PE'))!;
    expect(otmPut.label).toBe('Fair');
    expect(Math.abs(otmPut.richPct!)).toBeLessThan(0.01);
    expect(otmPut.pairIvGap).toBeCloseTo(0, 4);
  });

  it('flags a strike priced above or below the curve', () => {
    const inputs = chain({ '24400CE': smile(24400) + 0.03, '23600PE': smile(23600) - 0.03 });
    const { byToken } = computeFairValues(inputs);
    const rich = byToken.get(tokenOf(inputs, 24400, 'CE'))!;
    const cheap = byToken.get(tokenOf(inputs, 23600, 'PE'))!;
    expect(rich.label).toBe('Expensive');
    expect(rich.richPct!).toBeGreaterThan(0.1);
    expect(rich.ivGap!).toBeCloseTo(0.03, 2);
    expect(cheap.label).toBe('Cheap');
    // Parity check: the mispriced call shows up as a CE − PE IV gap at its strike.
    expect(rich.pairIvGap!).toBeCloseTo(0.03, 2);
  });

  it('reports ATM IV, straddle, ITM chance and distance in expected moves', () => {
    const inputs = chain();
    const { byToken, byExpiry } = computeFairValues(inputs);
    const stats = byExpiry.get(expiry)!;
    expect(stats.atmStrike).toBe(24000);
    expect(stats.atmIv!).toBeCloseTo(smile(24000), 3);
    expect(stats.straddle!).toBeGreaterThan(0);
    const farCall = byToken.get(tokenOf(inputs, 24800, 'CE'))!;
    expect(farCall.itmProb!).toBeLessThan(0.1);
    expect(farCall.moveMultiple!).toBeCloseTo(800 / stats.straddle!, 6);
    expect(describeFair(farCall).join(' ')).toContain('ITM chance');
  });
});

describe('realizedVol', () => {
  it('annualises the stdev of daily log returns', () => {
    const closes = [100];
    for (let i = 0; i < 20; i++) closes.push(closes[i] * (i % 2 ? Math.exp(0.01) : Math.exp(-0.01)));
    // Alternating ±1% log returns: sample stdev ≈ 1.026% → ≈ 16.3% annualised.
    expect(realizedVol(closes)!).toBeCloseTo(0.01 * Math.sqrt(20 / 19) * Math.sqrt(252), 6);
    expect(realizedVol([100, 101, 102])).toBeNull();
  });

  it('reads IV against realised vol', () => {
    expect(volVerdict(0.15, 0.1)).toBe('Options expensive');
    expect(volVerdict(0.1, 0.12)).toBe('Options cheap');
    expect(volVerdict(0.12, 0.11)).toBe('Fairly priced');
    expect(volVerdict(null, 0.1)).toBeNull();
  });
});
