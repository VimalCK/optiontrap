import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkTimeLabel, HealthCheckRow, oiFeedStatus } from './Health';

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST

describe('checkTimeLabel', () => {
  it('shows the IST time today, and the date too on another day', () => {
    expect(checkTimeLabel('2026-11-05T06:30:00Z', NOON)).toBe('12:00 IST');
    expect(checkTimeLabel('2026-11-04T09:40:00Z', NOON)).toBe('04 Nov 15:10 IST');
  });
});

describe('oiFeedStatus', () => {
  const AFTER_MIDNIGHT = new Date('2026-11-11T23:41:00Z'); // Thu 12 Nov 05:11 IST

  it("shows the newest snapshot from an earlier day (not 'no data'), as Idle", () => {
    const yesterday = new Date('2026-11-11T07:00:00Z').getTime(); // Wed 11 Nov 12:30 IST
    expect(oiFeedStatus(yesterday, AFTER_MIDNIGHT)).toEqual({ text: 'Last snapshot 11 Nov 12:30 IST · 16h ago', fresh: false });
  });

  it("is Fresh with today's snapshot, timed in IST", () => {
    const tenPast = new Date('2026-11-12T03:30:00Z').getTime(); // Thu 12 Nov 09:00 IST
    expect(oiFeedStatus(tenPast, new Date('2026-11-12T03:42:00Z'))).toEqual({ text: 'Last snapshot 09:00 IST · 12m ago', fresh: true });
  });

  it('says there are no snapshots at all only when there are none', () => {
    expect(oiFeedStatus(null, AFTER_MIDNIGHT)).toEqual({ text: 'No snapshots yet', fresh: false });
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
