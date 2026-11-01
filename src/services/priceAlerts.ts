/**
 * Price alerts API client. Alerts are stored per user on the server; the
 * Watchlist page checks live ticks against them and reports triggers back.
 */
import { apiClient } from './apiClient';

export type PriceAlertCondition = 'above' | 'below';
export type PriceAlertStatus = 'active' | 'triggered';

export interface PriceAlert {
  id: string;
  instrumentToken: number;
  tradingsymbol: string;
  exchange: string;
  condition: PriceAlertCondition;
  value: number;
  note?: string;
  browserNotification: boolean;
  status: PriceAlertStatus;
  triggeredAt?: string;
  triggeredPrice?: number;
  createdAt: string;
}

export type NewPriceAlert = Omit<PriceAlert, 'id' | 'status' | 'triggeredAt' | 'triggeredPrice' | 'createdAt'>;

export async function fetchPriceAlerts(signal?: AbortSignal): Promise<PriceAlert[]> {
  return apiClient.get<PriceAlert[]>('/api/price-alerts', { signal });
}

export async function createPriceAlert(input: NewPriceAlert): Promise<PriceAlert> {
  return apiClient.post<PriceAlert>('/api/price-alerts', input);
}

export async function triggerPriceAlert(id: string, price: number): Promise<PriceAlert> {
  return apiClient.post<PriceAlert>(`/api/price-alerts/${id}/trigger`, { price });
}

export async function resetPriceAlert(id: string): Promise<PriceAlert> {
  return apiClient.post<PriceAlert>(`/api/price-alerts/${id}/reset`);
}

export async function deletePriceAlert(id: string): Promise<void> {
  await apiClient.delete(`/api/price-alerts/${id}`);
}

export function isPriceAlertTriggered(alert: PriceAlert, currentPrice: number): boolean {
  if (alert.status !== 'active') return false;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;

  if (alert.condition === 'above') return currentPrice >= alert.value;
  return currentPrice <= alert.value;
}

export function describePriceAlert(alert: PriceAlert): string {
  const condition = alert.condition === 'above' ? 'above' : 'below';
  return `${alert.tradingsymbol} ${condition} ${alert.value.toFixed(2)}`;
}
