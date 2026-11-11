import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkTimeLabel, HealthCheckRow } from './Health';

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST

describe('checkTimeLabel', () => {
  it('shows the IST time today, and the date too on another day', () => {
    expect(checkTimeLabel('2026-11-05T06:30:00Z', NOON)).toBe('12:00 IST');
    expect(checkTimeLabel('2026-11-04T09:40:00Z', NOON)).toBe('04 Nov 15:10 IST');
  });
});

describe('HealthCheckRow', () => {
  const render = (check: Parameters<typeof HealthCheckRow>[0]['check']) =>
    renderToStaticMarkup(<HealthCheckRow icon={null} name="Trade Monitor" check={check} />);

  it('shows the name, the output and a badge for each status', () => {
    const html = render({ status: 'fail', output: '1 open position unwatched · no admin Kite login', time: null });
    expect(html).toContain('<strong>Trade Monitor</strong>');
    expect(html).toContain('<small>1 open position unwatched · no admin Kite login</small>');
    expect(html).toContain('hx-badge--down');
    expect(html).toContain('Failing');
    expect(render({ status: 'warn', output: 'x', time: null })).toContain('hx-badge--warn');
    expect(render({ status: 'pass', output: 'x', time: null })).toContain('hx-badge--up');
  });

  it('adds when the check was observed', () => {
    expect(render({ status: 'pass', output: 'Last run · 1 user · 1 signal', time: new Date().toISOString() }))
      .toMatch(/<small>Last run · 1 user · 1 signal · \d\d:\d\d IST<\/small>/);
  });
});
