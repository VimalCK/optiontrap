import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TrapVerdictCard from './TrapVerdictCard';
import type { TrapAnalysis } from '@/services/trapAnalysis';
import { OptionType } from '../../../shared/tradeEnums.js';
import { Bias, OiSignal, TrapVerdict } from '../../../shared/analysisEnums.js';

const analysis: TrapAnalysis = {
  trapScore: 3, verdict: TrapVerdict.Caution, verdictLabel: 'Caution', reasons: ['Short buildup near spot'],
  maxPain: 25000, pcr: 1, distanceToMaxPain: 100,
  oiSignal: { signal: OiSignal.Neutral, label: 'Neutral', description: '', sentiment: Bias.Neutral },
  nearestResistance: { strike: 25200, strength: 1.8 } as TrapAnalysis['nearestResistance'], nearestSupport: null,
};

describe('TrapVerdictCard', () => {
  const html = renderToStaticMarkup(<TrapVerdictCard analysis={analysis} strike={25100} optionType={OptionType.CE} />);

  it('heads the card with the strike, option and verdict, in the verdict colour', () => {
    expect(html).toContain('class="trap-verdict trap-verdict--caution"');
    expect(html).toContain('25,100 CE');
    expect(html).toContain('trap-verdict__pill">Caution<');
  });

  it('fills the score meter to the score on the 0–9 scale', () => {
    expect(html).toMatch(/trap-verdict__meter-fill" style="width:33\.3/);
    expect(html).toContain('>3<span class="trap-verdict__meter-of"> / 9</span>');
  });

  it('shows a dash for a missing level and lists the reasons', () => {
    expect(html).toContain('25200 <span class="trap-detail__note">1.8x OI</span>');
    expect(html).toMatch(/Support<\/span><span class="trap-detail__value">—/);
    expect(html).toContain('<li class="trap-reason">Short buildup near spot</li>');
  });
});
