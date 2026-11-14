import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PnLHeatmap from './PnLHeatmap';

const END = new Date(2026, 10, 5); // 5 Nov 2026
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NO_TOTALS = { pnl: 0, charges: 0, realised: 0 };
const dayLabels = (html: string) => [...html.matchAll(/class="heatmap-day-label">(\w+)</g)].map((m) => m[1]);
// Coloured day squares that can be hovered (days up to today).
const coloured = (html: string) =>
  [...html.matchAll(/class="([^"]*)"/g)].filter(([, cls]) => /heatmap-cell--(profit|loss)\b/.test(cls) && cls.includes('heatmap-cell--hoverable')).length;

const statValues = (html: string) => [...html.matchAll(/class="heatmap-stat__value[^"]*">(.*?)<\/span>/g)].map((m) => m[1]);

describe('PnLHeatmap stats', () => {
  it("shows the range's totals and its day counts", () => {
    const daily = new Map([['2026-10-15', 500], ['2026-10-16', -200], ['2026-10-19', 300]]);
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={daily} totals={{ pnl: 600, charges: 40, realised: 560 }} endDate={END} />);
    expect(statValues(html)).toEqual(['+600.00', '40.00', '+560.00', '3', '2', '1', '66.7%']);
    expect(html).toContain('title="Total P&amp;L minus charges">Realised P&amp;L</span>');
  });

  it('shimmers every figure while the report loads, keeping the labels', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map()} totals={NO_TOTALS} endDate={END} loading />);
    expect(statValues(html).every((value) => value.includes('class="shimmer shimmer--text"'))).toBe(true);
    expect(statValues(html)).toHaveLength(7);
    expect(html).toContain('>Win Rate</span>');
  });
});

describe('PnLHeatmap', () => {
  it('always shows all seven days, even with no trades', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map()} totals={NO_TOTALS} endDate={END} />);
    expect(dayLabels(html)).toEqual(ALL_DAYS);
  });

  it('shows all seven days when every trade day is a weekday', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map([['2026-10-16', 500]])} totals={NO_TOTALS} endDate={END} />);
    expect(dayLabels(html)).toEqual(ALL_DAYS);
    expect(coloured(html)).toBe(1);
  });

  it('colours a trade day that falls on a weekend', () => {
    const html = renderToStaticMarkup(
      <PnLHeatmap dailyPnL={new Map([['2026-10-17', -27946.75]])} totals={NO_TOTALS} endDate={END} />, // Saturday
    );
    expect(coloured(html)).toBe(1);
    expect(html).toContain('heatmap-cell--loss');
  });

  it('shows Total P&L, then Charges, then Realised P&L, each in its tone', () => {
    const html = renderToStaticMarkup(
      <PnLHeatmap dailyPnL={new Map([['2026-10-16', 720]])} totals={{ pnl: 800, charges: 80, realised: 720 }} endDate={END} />,
    );
    const stats = [...html.matchAll(/class="heatmap-stat__label"[^>]*>([^<]+)<\/span><span class="heatmap-stat__value ?([^"]*)">([^<]+)</g)]
      .map(([, label, tone, value]) => [label.replace('&amp;', '&'), tone.trim(), value]);
    expect(stats.slice(0, 3)).toEqual([
      ['Total P&L', 'heatmap-positive', '+800.00'],
      ['Charges', '', '80.00'],
      ['Realised P&L', 'heatmap-positive', '+720.00'],
    ]);
  });

  it('draws one square for every day of the year, weekends included', () => {
    const html = renderToStaticMarkup(<PnLHeatmap dailyPnL={new Map()} totals={NO_TOTALS} endDate={END} />);
    const days = [...html.matchAll(/class="heatmap-cell[^"]*"/g)]
      .map((m) => m[0])
      .filter((cls) => !cls.includes('filler'));
    expect(days).toHaveLength(365); // 2026
  });
});
