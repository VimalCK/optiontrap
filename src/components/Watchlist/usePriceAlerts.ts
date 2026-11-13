import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPriceAlert, deletePriceAlert, describePriceAlert, fetchPriceAlerts, resetPriceAlert, triggerPriceAlert,
  type NewPriceAlert, type PriceAlert,
} from '@/services/priceAlerts';
import { ApiError, isAbortError } from '@/services/apiClient';
import type { Tick } from '@/services/kiteTicker';
import { alertHits, markTriggered } from './priceAlertRows';
import { formatPrice } from './watchlistRows';

const TOAST_MS = 5000;

export const failureMessage = (action: string, err: unknown) => `Couldn't ${action}: ${err instanceof Error ? err.message : 'request failed'}`;

/** A message shown for five seconds; a new one replaces it. */
export function useTimedToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  return { toast, showToast };
}

/**
 * The user's price alerts: loaded once, checked against every tick (`checkTicks`), and created, reset or deleted
 * here. A hit is marked triggered at once, so the next tick doesn't fire it again, then saved.
 */
export function usePriceAlerts(showToast: (message: string) => void) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  // Read by the tick handler, which fires too often to re-create on every alert change.
  const alertsRef = useRef<PriceAlert[]>([]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    const controller = new AbortController();
    fetchPriceAlerts(controller.signal)
      .then(setAlerts)
      .catch((err) => { if (!isAbortError(err)) console.error('[Watchlist] Price alerts load failed:', err); });
    return () => controller.abort();
  }, []);

  const notifyTriggered = useCallback((alert: PriceAlert, currentPrice: number) => {
    const message = `${describePriceAlert(alert)} hit. Current: ${formatPrice(currentPrice)}`;
    showToast(message);
    if (alert.browserNotification && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('OptionTrap Price Alert', { body: message });
    }
  }, [showToast]);

  const checkTicks = useCallback((ticks: Tick[]) => {
    const hits = alertHits(alertsRef.current, ticks);
    if (hits.size === 0) return;

    const triggeredAt = new Date().toISOString();
    for (const alert of alertsRef.current) {
      const price = hits.get(alert.id);
      if (price !== undefined) notifyTriggered(alert, price);
    }
    alertsRef.current = markTriggered(alertsRef.current, hits, triggeredAt);
    setAlerts((prev) => markTriggered(prev, hits, triggeredAt));

    for (const [id, price] of hits) {
      triggerPriceAlert(id, price)
        .then((saved) => setAlerts((prev) => prev.map((alert) => (alert.id === saved.id ? saved : alert))))
        .catch((err) => {
          // 404: another tab or device already triggered it, or it was deleted.
          if (!(err instanceof ApiError && err.status === 404)) console.error('[Watchlist] Saving triggered alert failed:', err);
        });
    }
  }, [notifyTriggered]);

  /** Resolves to whether it was saved. */
  const createAlert = async (input: NewPriceAlert): Promise<boolean> => {
    try {
      const alert = await createPriceAlert(input);
      setAlerts((prev) => [alert, ...prev]);
      return true;
    } catch (err) {
      showToast(failureMessage('save the alert', err));
      return false;
    }
  };

  const deleteAlert = async (id: string) => {
    try {
      await deletePriceAlert(id);
      setAlerts((prev) => prev.filter((alert) => alert.id !== id));
    } catch (err) {
      showToast(failureMessage('delete the alert', err));
    }
  };

  const resetAlert = async (id: string) => {
    try {
      const saved = await resetPriceAlert(id);
      setAlerts((prev) => prev.map((alert) => (alert.id === id ? saved : alert)));
    } catch (err) {
      showToast(failureMessage('reset the alert', err));
    }
  };

  return { alerts, checkTicks, createAlert, deleteAlert, resetAlert };
}
