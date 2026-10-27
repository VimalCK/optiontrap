import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OiChartGuide, SellStrategyGuide, BuyStrategyGuide, PositionAnalyzerGuide } from './AnalyzerGuides';
import { PatternGuide } from '@/components/OiHistory/PatternGuide';

describe('info guides', () => {
  it('describes the redesigned OI chart tooltip, including IV flow', () => {
    const html = renderToStaticMarkup(<OiChartGuide />);
    expect(html).toContain('Reading the OI chart');
    expect(html).toContain('IV flow');
    expect(html).toContain('Writers Adding');
    expect(html).toContain('OI change under 2% since yesterday');
    expect(html).not.toContain('CE/PE Vel');
  });

  it('flags OI + Price as scored and IV flow as not scored', () => {
    for (const Guide of [SellStrategyGuide, BuyStrategyGuide, PositionAnalyzerGuide]) {
      const html = renderToStaticMarkup(<Guide />);
      expect(html).toContain('info-guide__note');
      expect(html).toContain('not scored yet');
    }
    expect(renderToStaticMarkup(<PositionAnalyzerGuide />)).toContain('Likely Trapped');
  });

  it('keeps the OI History guide on the shared layout', () => {
    const html = renderToStaticMarkup(<PatternGuide />);
    expect(html).toContain('info-guide__section');
    expect(html).toContain('Rolling Over (Short)');
    expect(html).toContain('2% without history');
  });
});
