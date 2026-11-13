import React, { useCallback, useState } from 'react';
import IconButton from '@/components/IconButton/IconButton';
import { ChevronDownIcon, ChevronRightIcon, CloseIcon } from '@/components/icons/Icons';
import { placeOrder, placedOrderMessage, placedOrderRefused } from '@/services/orders';
import { instrumentName, tradeErrorMessage } from '@/services/positions';
import { formatAmount } from '@/utils/formatAmount';
import { formatCalendarDate } from '@/utils/marketStatus';
import { ToastColor, type ToastColorId } from '@/utils/uiEnums';
import { HORIZONS, OrderType, Side, TradingMode, type HorizonId, type OrderTypeId, type SideId, type TradingModeId } from '../../../shared/tradeEnums.js';
import OrderModalSwitch from './OrderModalSwitch';
import { ticketOrder, type OrderOption } from './orderTicket';
import type { OrderChoices } from './useOrderChoices';
import '@/styles/orderModal.css';

const SIDE_OPTIONS: { value: SideId; label: string }[] = [{ value: Side.BUY, label: 'Buy' }, { value: Side.SELL, label: 'Sell' }];
const MODE_OPTIONS: { value: TradingModeId; label: string }[] = [{ value: TradingMode.Paper, label: 'Paper' }, { value: TradingMode.Live, label: 'Live' }];
const ORDER_TYPE_OPTIONS: { value: OrderTypeId; label: string }[] = [{ value: OrderType.Market, label: 'Market' }, { value: OrderType.Limit, label: 'Limit' }];
const HORIZON_OPTIONS: { value: HorizonId; label: string }[] = HORIZONS.map((h) => ({ value: h.id, label: h.label }));
const DEFAULT_CONFIDENCE = 70;
const PRICE_STEP = 0.5;
/** A market order fills at the live bid / ask when placed (server/tradeEngine/fillPrice.js), so it has no price to enter. */
const MARKET_PRICE_TEXT = 'At market';

export interface OrderModalProps {
  option: OrderOption;
  /** Where the price field starts: the premium the user clicked. */
  initialPrice: number;
  /** What that premium is, shown beside it: "LTP" on a live chain, "Day close" on a past day. */
  priceLabel: string;
  choices: OrderChoices;
  onClose: () => void;
  onToast: (text: string, color: ToastColorId) => void;
}

const NumberField: React.FC<{
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
  onUp: () => void;
  onDown: () => void;
  /** Empty and locked, with this text in its place: a value the user can't set (a market order's price). */
  disabledText?: string;
}> = ({ label, value, min, step, onChange, onUp, onDown, disabledText }) => (
  <div className="order-modal__field">
    <span>{label}</span>
    <div className={`order-modal__number ${disabledText ? 'order-modal__number--disabled' : ''}`}>
      <input type="number" value={disabledText ? '' : value} placeholder={disabledText} disabled={Boolean(disabledText)}
        onChange={(e) => onChange(Number(e.target.value))} min={min} step={step} aria-label={label} />
      <div className="order-modal__number-btns">
        <button type="button" className="order-modal__number-btn" onClick={onUp} disabled={Boolean(disabledText)} aria-label={`More ${label.toLowerCase()}`}>▲</button>
        <button type="button" className="order-modal__number-btn" onClick={onDown} disabled={Boolean(disabledText)} aria-label={`Less ${label.toLowerCase()}`}>▼</button>
      </div>
    </div>
  </div>
);

/** The order popup for one option contract. Open it with a `key` per contract, so its fields start afresh. */
const OrderModal: React.FC<OrderModalProps> = ({ option, initialPrice, priceLabel, choices, onClose, onToast }) => {
  const [side, setSide] = useState<SideId>(Side.BUY);
  const [quantity, setQuantity] = useState(option.lotSize);
  const [price, setPrice] = useState(initialPrice);
  const [showDetails, setShowDetails] = useState(false);
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [confidence, setConfidence] = useState(DEFAULT_CONFIDENCE);
  const [note, setNote] = useState('');
  // Focus once when it opens (so Escape closes it). A stable callback ref: an inline one is called on every render
  // and would pull focus out of the inputs on each tick.
  const focusOnOpen = useCallback((el: HTMLDivElement | null) => el?.focus(), []);

  const isPaper = choices.mode === TradingMode.Paper;
  const isLimit = isPaper && choices.orderType === OrderType.Limit;
  const title = `${instrumentName({ instrumentType: option.optionType, tradingsymbol: option.tradingsymbol })} ${option.strike} ${option.optionType}`;

  const submit = async () => {
    const order = ticketOrder(option, side, { quantity, price, targetPrice, stopLossPrice, confidence, note }, choices);
    try {
      const placed = await placeOrder(order);
      onToast(placedOrderMessage(placed, `${side} ${option.strike}${option.optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
    } catch (err) {
      onToast(tradeErrorMessage(err, isLimit ? 'Failed to place order' : undefined), ToastColor.Red);
    }
    onClose();
  };

  return (
    <div className="order-modal-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} tabIndex={-1} ref={focusOnOpen}>
      <div className={`order-modal order-modal--${side.toLowerCase()}`} role="dialog" aria-label={`Order ${title}`} onClick={(e) => e.stopPropagation()}>
        <div className="order-modal__header">
          <div>
            <div className="order-modal__title">{title} <span className="order-modal__expiry">· {formatCalendarDate(option.expiry, { day: 'numeric', month: 'short' })}</span></div>
            <div className="order-modal__premium">{priceLabel} ₹{formatAmount(initialPrice)}</div>
          </div>
          <IconButton icon={<CloseIcon />} label="Close" onClick={onClose} />
        </div>

        <div className="order-modal__body">
          <div className="order-modal__row">
            {isPaper && (
              <div className={`order-modal__side order-modal__side--${side.toLowerCase()}`}>
                <OrderModalSwitch label="Side" options={SIDE_OPTIONS} value={side} onChange={setSide} />
              </div>
            )}
            <div className="order-modal__trading-mode">
              <OrderModalSwitch label="Trading mode" options={MODE_OPTIONS} value={choices.mode} onChange={choices.chooseMode} />
            </div>
          </div>

          {isPaper && (
            <>
              <div className="order-modal__fields">
                <NumberField label={`Qty (lot ${option.lotSize})`} value={quantity} min={option.lotSize} step={option.lotSize} onChange={setQuantity}
                  onUp={() => setQuantity(quantity + option.lotSize)} onDown={() => setQuantity(Math.max(option.lotSize, quantity - option.lotSize))} />
                <NumberField label={isLimit ? 'Limit price' : 'Price'} value={price} min={0} step={0.05} onChange={setPrice}
                  onUp={() => setPrice(+(price + PRICE_STEP).toFixed(2))} onDown={() => setPrice(Math.max(0, +(price - PRICE_STEP).toFixed(2)))}
                  disabledText={isLimit ? undefined : MARKET_PRICE_TEXT} />
              </div>

              <div className="order-modal__fields">
                <div className="order-modal__field">
                  <span>Order</span>
                  <OrderModalSwitch label="Order type" options={ORDER_TYPE_OPTIONS} value={choices.orderType} onChange={choices.setOrderType} />
                </div>
                <div className="order-modal__field">
                  <span>Trade</span>
                  <OrderModalSwitch label="Trade type" options={HORIZON_OPTIONS} value={choices.horizon} onChange={choices.setHorizon} />
                </div>
              </div>

              <button type="button" className="order-modal__details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>
                {showDetails ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                Add target, stop-loss, note
              </button>
              {showDetails && (
                <div className="order-modal__details">
                  <div className="order-modal__fields">
                    <label className="order-modal__field">
                      <span>Target</span>
                      <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} min={0} step={0.05} placeholder="Optional" />
                    </label>
                    <label className="order-modal__field">
                      <span>Stop-loss</span>
                      <input type="number" value={stopLossPrice} onChange={(e) => setStopLossPrice(e.target.value)} min={0} step={0.05} placeholder="Optional" />
                    </label>
                  </div>
                  <label className="order-modal__field">
                    <span>Confidence: {confidence}%</span>
                    <input type="range" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} min={0} max={100} step={5} />
                  </label>
                  <label className="order-modal__field">
                    <span>Trade note</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={240} placeholder="Why are you taking this trade?" />
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        <div className="order-modal__footer">
          {isPaper ? (
            <button type="button" className={`order-modal__submit order-modal__submit--${side.toLowerCase()}`} onClick={submit}>
              {side} {quantity} @ {isLimit ? formatAmount(price) : 'MKT'}
            </button>
          ) : (
            <p className="order-modal__live-notice">Live trading coming soon. Use Paper mode to track positions.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderModal;
