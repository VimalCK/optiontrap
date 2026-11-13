import React, { useState } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import type { NewPriceAlert } from '@/services/priceAlerts';
import type { WatchlistItem } from '@/services/watchlist';
import { PRICE_ALERT_CONDITIONS, PriceAlertCondition, type PriceAlertConditionId } from '../../../shared/appEnums.js';

const PRICE_STEP = 0.05;
const NOTE_MAX_LENGTH = 160;

export interface AlertPrefill {
  condition: PriceAlertConditionId;
  value: number;
  note: string;
}

/** Asks for browser notification permission when it hasn't been decided; resolves to whether notifications are on. */
async function notificationAllowed(wanted: boolean): Promise<boolean> {
  if (!wanted || !('Notification' in window) || Notification.permission !== 'default') return wanted;
  return (await Notification.requestPermission()) === 'granted';
}

/** The new-alert form for a list item: starts at the prefill (from a stock setup) or the current price. */
const PriceAlertModal: React.FC<{
  item: WatchlistItem;
  currentPrice: number | undefined;
  prefill?: AlertPrefill;
  onClose: () => void;
  /** Resolves to whether it was saved. */
  onCreate: (alert: NewPriceAlert) => Promise<boolean>;
}> = ({ item, currentPrice, prefill, onClose, onCreate }) => {
  const [condition, setCondition] = useState<PriceAlertConditionId>(prefill?.condition ?? PriceAlertCondition.Above);
  const [value, setValue] = useState(prefill ? prefill.value.toFixed(2) : currentPrice ? currentPrice.toFixed(2) : '');
  const [note, setNote] = useState(prefill?.note ?? '');
  const [browserNotification, setBrowserNotification] = useState(false);
  const valid = Number(value) > 0;

  const adjustValue = (delta: number) => setValue(Math.max(0, (Number(value) || 0) + delta).toFixed(2));

  const create = async () => {
    const price = Number(value);
    if (!Number.isFinite(price) || price <= 0) return;
    const saved = await onCreate({
      instrumentToken: item.instrumentToken,
      tradingsymbol: item.tradingsymbol,
      exchange: item.exchange,
      condition,
      value: price,
      note: note.trim() || undefined,
      browserNotification: await notificationAllowed(browserNotification),
    });
    if (saved) onClose();
  };

  return (
    <div className="wl-alert-modal-overlay" onMouseDown={onClose}>
      <div className="wl-alert-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wl-alert-modal__header">
          <div>
            <h3>Create Price Alert</h3>
            <p>{item.tradingsymbol}</p>
          </div>
          <button type="button" className="wl-alert-modal__close" onClick={onClose}>x</button>
        </div>

        <div className="wl-alert-modal__body">
          <label className="wl-alert-field">
            <span>Condition</span>
            <AppSelect
              value={condition}
              options={PRICE_ALERT_CONDITIONS.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(next) => setCondition(next as PriceAlertConditionId)}
              className="wl-alert-select"
            />
          </label>

          <label className="wl-alert-field">
            <span>Price</span>
            <div className="wl-alert-number">
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} min={0} step={PRICE_STEP} autoFocus />
              <div className="wl-alert-number__btns">
                <button type="button" className="wl-alert-number__btn" onClick={() => adjustValue(PRICE_STEP)}>▲</button>
                <button type="button" className="wl-alert-number__btn" onClick={() => adjustValue(-PRICE_STEP)}>▼</button>
              </div>
            </div>
          </label>

          <label className="wl-alert-field">
            <span>Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={NOTE_MAX_LENGTH} placeholder="Optional reason or action plan" />
          </label>

          <label className="wl-alert-check">
            <input type="checkbox" checked={browserNotification} onChange={(e) => setBrowserNotification(e.target.checked)} />
            <span className="wl-alert-check__box" aria-hidden="true" />
            <span>Browser notification</span>
          </label>
        </div>

        <div className="wl-alert-modal__footer">
          <button type="button" className="wl-alert-modal__secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="wl-alert-modal__primary" onClick={create} disabled={!valid}>Create Alert</button>
        </div>
      </div>
    </div>
  );
};

export default PriceAlertModal;
