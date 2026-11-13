import { describe, it, expect } from 'vitest';
import type { PriceAlert } from '@/services/priceAlerts';
import type { Tick } from '@/services/kiteTicker';
import { PriceAlertCondition, PriceAlertStatus } from '../../../shared/appEnums.js';
import { alertHits, countByStatus, formatAlertTime, groupAlerts, markTriggered } from './priceAlertRows';

const alert = (id: string, instrumentToken: number, value: number, status: PriceAlert['status'] = PriceAlertStatus.Active): PriceAlert => ({
  id, instrumentToken, tradingsymbol: `SYM${instrumentToken}`, exchange: 'NSE', condition: PriceAlertCondition.Above, value,
  browserNotification: false, status, createdAt: '2026-11-13T04:00:00Z',
});
const tick = (instrumentToken: number, lastPrice: number) => ({ instrumentToken, lastPrice }) as Tick;

describe('alertHits', () => {
  it('finds the active alerts a tick crosses, with its price', () => {
    const alerts = [alert('a', 1, 100), alert('b', 1, 200), alert('c', 2, 50)];
    expect(alertHits(alerts, [tick(1, 150)])).toEqual(new Map([['a', 150]]));
  });

  it('ignores triggered alerts', () => {
    expect(alertHits([alert('a', 1, 100, PriceAlertStatus.Triggered)], [tick(1, 150)]).size).toBe(0);
  });
});

describe('markTriggered', () => {
  it('marks only active hits, with the time and price', () => {
    const at = '2026-11-13T05:00:00Z'; // 10:30 IST
    const marked = markTriggered([alert('a', 1, 100), alert('b', 1, 200)], new Map([['a', 150]]), at);
    expect(marked[0]).toMatchObject({ status: PriceAlertStatus.Triggered, triggeredAt: at, triggeredPrice: 150 });
    expect(marked[1].status).toBe(PriceAlertStatus.Active);
  });
});

describe('formatAlertTime', () => {
  it('shows the trigger time in IST, whatever the browser zone', () => {
    expect(formatAlertTime('2026-11-13T04:00:00Z')).toMatch(/13 Nov.*09:30/i); // 09:30 IST
    expect(formatAlertTime(undefined)).toBe('-');
  });
});

describe('groupAlerts and countByStatus', () => {
  it('groups by instrument in first-seen order', () => {
    const groups = groupAlerts([alert('a', 2, 1), alert('b', 1, 1), alert('c', 2, 1)]);
    expect(groups.map((g) => [g.symbol, g.alerts.map((x) => x.id)])).toEqual([['SYM2', ['a', 'c']], ['SYM1', ['b']]]);
  });

  it('counts active and triggered', () => {
    expect(countByStatus([alert('a', 1, 1), alert('b', 1, 1, PriceAlertStatus.Triggered)])).toEqual({ active: 1, triggered: 1 });
  });
});
