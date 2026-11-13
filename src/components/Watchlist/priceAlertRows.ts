import { isPriceAlertTriggered, type PriceAlert } from '@/services/priceAlerts';
import type { Tick } from '@/services/kiteTicker';
import { PriceAlertStatus } from '../../../shared/appEnums.js';
import { MARKET_TIME_ZONE } from '../../../shared/marketTime.js';

export interface AlertGroup {
  key: string;
  symbol: string;
  exchange: string;
  alerts: PriceAlert[];
}

/** The alerts these ticks trigger, by id, with the price that did it. */
export function alertHits(alerts: PriceAlert[], ticks: Tick[]): Map<string, number> {
  const priceByToken = new Map(ticks.map((t) => [t.instrumentToken, t.lastPrice]));
  const hits = new Map<string, number>();
  for (const alert of alerts) {
    const currentPrice = priceByToken.get(alert.instrumentToken);
    if (currentPrice !== undefined && isPriceAlertTriggered(alert, currentPrice)) hits.set(alert.id, currentPrice);
  }
  return hits;
}

/** The alerts with each active hit marked triggered at `triggeredAt`. */
export const markTriggered = (alerts: PriceAlert[], hits: Map<string, number>, triggeredAt: string): PriceAlert[] =>
  alerts.map((alert) => (hits.has(alert.id) && alert.status === PriceAlertStatus.Active
    ? { ...alert, status: PriceAlertStatus.Triggered, triggeredAt, triggeredPrice: hits.get(alert.id) }
    : alert));

/** The alerts grouped by instrument, in the order each instrument first appears. */
export function groupAlerts(alerts: PriceAlert[]): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  for (const alert of alerts) {
    const key = `${alert.instrumentToken}`;
    const group = groups.get(key);
    if (group) group.alerts.push(alert);
    else groups.set(key, { key, symbol: alert.tradingsymbol, exchange: alert.exchange, alerts: [alert] });
  }
  return [...groups.values()];
}

export const countByStatus = (alerts: PriceAlert[]) => {
  const active = alerts.filter((alert) => alert.status === PriceAlertStatus.Active).length;
  return { active, triggered: alerts.length - active };
};

export const formatAlertTime = (value?: string) => (value
  ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MARKET_TIME_ZONE })
  : '-');
