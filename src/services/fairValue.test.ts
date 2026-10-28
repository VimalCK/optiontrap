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

/** A chain priced off the smile. `dividend` is paid before expiry, so prices use spot less its value while inputs still report the raw spot. */
function chain(overrides: Record<string, number> = {}, dividend = 0): FairInput[] {
  const inputs: FairInput[] = [];
  let token = 1;
  for (let strike = 23200; strike <= 24800; strike += 100) {
    for (const optionType of ['CE', 'PE'] as const) {
      const key = `${strike}${optionType}`;
      const iv = overrides[key] ?? smile(strike);
      const price = bsPrice(optionType, spot - dividend, strike, t, iv);
      inputs.push({ token: token++, optionType, strike, expiry, price, spot, asOf, volume: 1000 });
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

  /** A steep index-style skew in SVI form (variance, not IV): put wing far steeper than the call wing. */
  const sviIv = (k: number) => {
    const x = k - 0.01;
    return Math.sqrt(0.01 + 0.4 * (-0.7 * x + Math.sqrt(x * x + 0.03 ** 2)));
  };
  const sviPoints = Array.from({ length: 15 }, (_, i) => -0.08 + i * 0.01).map((k) => ({ k, iv: sviIv(k) }));

  it('fits an SVI skew across the strikes, between them, and a little past the last one', () => {
    const fit = fitSmile(sviPoints)!;
    for (let k = -0.08; k <= 0.06; k += 0.005) expect(Math.abs(fit(k)! - sviIv(k))).toBeLessThan(1e-4);
    // Wings are trusted 25% of the fitted range beyond each end, and no further.
    expect(Math.abs(fit(-0.1)! - sviIv(-0.1))).toBeLessThan(1e-3);
    expect(fit(-0.15)).toBeNull();
  });

  it('keeps an SVI fit when one strike is a bad print', () => {
    const noisy = sviPoints.map((p) => (Math.abs(p.k + 0.03) < 1e-9 ? { ...p, iv: p.iv + 0.05 } : p));
    const fit = fitSmile(noisy)!;
    expect(Math.abs(fit(-0.03)! - sviIv(-0.03))).toBeLessThan(1e-3);
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

  it('prices on the parity forward, which matches carry when there is no dividend', () => {
    const stats = computeFairValues(chain()).byExpiry.get(expiry)!;
    expect(stats.forwardSource).toBe('parity');
    expect(stats.forward).toBeCloseTo(forward, 6);
  });

  it('absorbs a dividend through the parity forward instead of skewing calls against puts', () => {
    const dividend = 150;
    const inputs = chain({}, dividend);
    const { byToken, byExpiry } = computeFairValues(inputs);
    expect(byExpiry.get(expiry)!.forward).toBeCloseTo((spot - dividend) * Math.exp(RISK_FREE_RATE * t), 6);

    // Priced on spot alone, every call would solve to a lower IV than its put.
    for (const strike of [23600, 24000, 24400]) {
      const call = byToken.get(tokenOf(inputs, strike, 'CE'))!;
      expect(call.iv!).toBeCloseTo(smile(strike), 4);
      expect(call.pairIvGap!).toBeCloseTo(0, 4);
      expect(call.label).toBe('Fair');
    }
  });

  it('falls back to the carry forward when parity has too few paired strikes', () => {
    // Only OTM legs: no strike has both a CE and a PE.
    const inputs = chain().filter((i) => (i.optionType === 'CE' ? i.strike > 24000 : i.strike < 24000));
    const stats = computeFairValues(inputs).byExpiry.get(expiry)!;
    expect(stats.forwardSource).toBe('carry');
    expect(stats.forward).toBeCloseTo(forward, 6);
  });

  it('ignores a parity forward implausibly far from carry', () => {
    // Prices consistent with spot 20% lower than reported: bad data, not a dividend.
    const stats = computeFairValues(chain({}, spot * 0.2)).byExpiry.get(expiry)!;
    expect(stats.forwardSource).toBe('carry');
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
