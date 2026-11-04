import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PnLHeatmap from './PnLHeatmap';

const END = new Date(2026, 10, 5); // 5 Nov 2026
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayLabels = (html: string) => [...html.matchAll(/class="heatmap-day-label">(\w+)</g)].map((m) => m[1]);
// Coloured day squares only: the legend's sample squares aren't hoverable.
const coloured = (html: string) =>
  [...html.matchAll(/class="([^"]*)"/g)].filter(([, cls]) => /heatmap-cell--(profit|loss)\b/.test(cls) && cls.includes('heatmap-cell--hoverable')).length;

describe('PnLHeatmap', () => {
  it('always shows all seven days, even with no trades', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map()} endDate={END} />);
    expect(dayLabels(html)).toEqual(ALL_DAYS);
  });

  it('shows all seven days when every trade day is a weekday', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map([['2026-10-16', 500]])} endDate={END} />);
    expect(dayLabels(html)).toEqual(ALL_DAYS);
    expect(coloured(html)).toBe(1);
  });

  it('colours a trade day that falls on a weekend', () => {
    const html = renderToStaticMarkup(
      <PnLHeatmap dailyPnL={new Map([['2026-10-17', -27946.75]])} endDate={END} />, // Saturday
    );
    expect(coloured(html)).toBe(1);
    expect(html).toContain('heatmap-cell--loss');
  });

  it('draws one square for every day of the year, weekends included', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map()} endDate={END} />);
    const days = [...html.matchAll(/class="heatmap-cell[^"]*"/g)]
      .map((m) => m[0])
      .filter((cls) => !cls.includes('filler') && !cls.includes('legend'));
    expect(days).toHaveLength(365); // 2026
  });
});
