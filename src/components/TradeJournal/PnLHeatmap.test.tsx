import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PnLHeatmap, { isWeekendDate } from './PnLHeatmap';

const END = new Date(2026, 10, 5); // 5 Nov 2026
const dayLabels = (html: string) => [...html.matchAll(/class="heatmap-day-label">(\w+)</g)].map((m) => m[1]);
// Coloured day squares only: the legend's sample squares aren't hoverable.
const coloured = (html: string) =>
  [...html.matchAll(/class="([^"]*)"/g)].filter(([, cls]) => /heatmap-cell--(profit|loss)\b/.test(cls) && cls.includes('heatmap-cell--hoverable')).length;

describe('isWeekendDate', () => {
  it('recognises Saturdays and Sundays', () => {
    expect(isWeekendDate('2026-10-17')).toBe(true); // Sat
    expect(isWeekendDate('2026-10-18')).toBe(true); // Sun
    expect(isWeekendDate('2026-10-16')).toBe(false); // Fri
    expect(isWeekendDate('2026-10-19')).toBe(false); // Mon
  });
});

describe('PnLHeatmap', () => {
  it('shows Mon–Fri when every trade day is a weekday', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map([['2026-10-16', 500]])} endDate={END} />);
    expect(dayLabels(html)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(coloured(html)).toBe(1);
  });

  it('adds Sat and Sun rows when a trade day falls on a weekend, and colours it', () => {
    const html = renderToStaticMarkup(
      <PnLHeatmap dailyPnL={new Map([['2026-10-17', -27946.75]])} endDate={END} />,
    );
    expect(dayLabels(html)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(coloured(html)).toBe(1);
    expect(html).toContain('heatmap-cell--loss');
  });

  it('shows Mon–Fri when there are no trades', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map()} endDate={END} />);
    expect(dayLabels(html)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });
});
