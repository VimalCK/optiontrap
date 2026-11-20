import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TrapMap, { barShare, type TrapMapRow } from './TrapMap';
import { Bias, OiSignal, TrapVerdict } from '../../../shared/analysisEnums.js';

const row = (strike: number, trapScore: number, verdict: TrapMapRow['verdict'], verdictLabel: string): TrapMapRow => ({
  strike, trapScore, verdict, verdictLabel, reasons: [], maxPain: 25000, pcr: 1, distanceToMaxPain: 0,
  oiSignal: { signal: OiSignal.Neutral, label: 'Neutral', description: '', sentiment: Bias.Neutral },
  nearestResistance: null, nearestSupport: null,
});

const render = () => renderToStaticMarkup(
  <TrapMap
    ceRows={[row(24900, 0, TrapVerdict.Safe, 'Safe'), row(25000, 3, TrapVerdict.Caution, 'Caution'), row(25100, 6, TrapVerdict.LikelyTrapped, 'Likely Trapped')]}
    peRows={[row(24900, 4, TrapVerdict.LikelyTrapped, 'Likely Trapped'), row(25000, 0, TrapVerdict.Safe, 'Safe'), row(25100, 0, TrapVerdict.Safe, 'Safe')]}
    atmStrike={25000}
    maxPain={24900}
    spotPrice={25010}
    expectedMove={100}
    labelStep={100}
    onSelect={() => {}}
  />,
);

describe('barShare', () => {
  it('scales a score on the 0–9 scale, and keeps a stub for a safe 0', () => {
    expect(barShare(9)).toBe(1);
    expect(barShare(3)).toBeCloseTo(1 / 3);
    expect(barShare(0)).toBeGreaterThan(0);
  });
});

describe('TrapMap', () => {
  it('reads out the ATM strike until a bar is hovered', () => {
    const html = render();
    expect(html).toContain('trap-map__readout-strike">25,000<');
    expect(html).toContain('CE · Caution');
    expect(html).toContain('PE · Safe');
    expect(html).toContain('>ATM<');
  });

  it('colours each bar by its verdict and flags ATM and max pain above their columns', () => {
    const html = render();
    expect(html).toContain('trap-map__bar trap-map__bar--likelytrapped');
    expect(html).toContain('trap-map__flag trap-map__flag--atm');
    expect(html).toContain('trap-map__flag trap-map__flag--maxpain');
    expect(html).toContain('>Calls<');
    expect(html).toContain('>Puts<');
  });
});
