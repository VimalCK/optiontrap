import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StrategySummaryBar, { gaugePosition } from './StrategySummaryBar';
import { DayLean } from '../../../shared/analysisEnums.js';

describe('gaugePosition', () => {
  it('puts −1 at the left edge, 0 in the middle and +1 at the right edge', () => {
    expect(gaugePosition(-1)).toBe(0);
    expect(gaugePosition(0)).toBe(50);
    expect(gaugePosition(0.62)).toBeCloseTo(81);
    expect(gaugePosition(1)).toBe(100);
  });
});

describe('StrategySummaryBar', () => {
  const bar = (day?: Parameters<typeof StrategySummaryBar>[0]['day']) =>
    renderToStaticMarkup(<StrategySummaryBar maxPain={25000} pcr={1.33} spot={25138} expectedMove={182} day={day} />);

  it('shows the day\'s lean on the gauge with what it read', () => {
    const html = bar({ bias: 0.62, lean: DayLean.Bullish, readings: { since: '09:15', dayMove: 128, recentMove: 35, putOiAdded: 48e4, callOiAdded: -2e4, pcrFrom: 0.65, pcrTo: 1.33 } });
    expect(html).toContain('Bullish +0.62');
    expect(html).toContain('left:81%');
    expect(html).toContain('Spot today');
    expect(html).toContain('Put +4.8L · Call −0.2L');
    expect(html).toContain('sell-strategy__reading-value--bullish');
  });

  it('leaves the gauge out before there is a reading', () => {
    const html = bar(null);
    expect(html).toContain('±182');
    expect(html).not.toContain('sell-strategy__gauge');
  });
});
