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

const STORAGE_KEY = 'optiontrap_price_alerts';

export function loadPriceAlerts(): PriceAlert[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as PriceAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePriceAlerts(alerts: PriceAlert[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
}

export function createPriceAlert(input: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>): PriceAlert {
  return {
    ...input,
    id: crypto.randomUUID(),
    status: 'active',
    createdAt: new Date().toISOString(),
  };
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
