import React, { useState } from 'react';
import Modal from '@/components/Modal/Modal';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons/Icons';
import { modifiedOrderMessage, modifyOrder, placeOrder, placedOrderMessage, placedOrderRefused, type PaperOrder } from '@/services/orders';
import { instrumentName, tradeErrorMessage } from '@/services/positions';
import { formatAmount } from '@/utils/formatAmount';
import { formatCalendarDate } from '@/utils/marketStatus';
import { ToastColor, type ToastColorId } from '@/utils/uiEnums';
import { HORIZONS, OrderType, Side, TradingMode, type HorizonId, type OrderTypeId, type SideId, type TradingModeId } from '../../../shared/tradeEnums.js';
import OrderModalSwitch from './OrderModalSwitch';
import { DEFAULT_CONFIDENCE, pendingOrderFields, ticketChanges, ticketOrder, type OrderOption, type OrderTicketFields } from './orderTicket';
import type { OrderChoices } from './useOrderChoices';
import '@/styles/orderModal.css';

const SIDE_OPTIONS: { value: SideId; label: string }[] = [{ value: Side.BUY, label: 'Buy' }, { value: Side.SELL, label: 'Sell' }];
const MODE_OPTIONS: { value: TradingModeId; label: string }[] = [{ value: TradingMode.Paper, label: 'Paper' }, { value: TradingMode.Live, label: 'Live' }];
const ORDER_TYPE_OPTIONS: { value: OrderTypeId; label: string }[] = [{ value: OrderType.Market, label: 'Market' }, { value: OrderType.Limit, label: 'Limit' }];
const HORIZON_OPTIONS: { value: HorizonId; label: string }[] = HORIZONS.map((h) => ({ value: h.id, label: h.label }));
const PRICE_STEP = 0.5;
/** A market order fills at the live bid / ask when placed (server/tradeEngine/fillPrice.js), so it has no price to enter. */
const MARKET_PRICE_TEXT = 'At market';
const MODIFY_EYEBROW = 'Modify';

export interface OrderModalProps {
  option: OrderOption;
  /** Where the price field starts: the premium the user clicked. */
  initialPrice: number;
  /** What that premium is, shown beside it: "LTP" on a live chain, "Day close" on a past day. */
  priceLabel: string;
  choices: OrderChoices;
  onClose: () => void;
  onToast: (text: string, color: ToastColorId) => void;
  /**
   * A pending order to modify instead of placing a new one: the popup starts from its terms, keeps its side and
   * trade type (like Zerodha's modify) and saves the changes to it. `initialPrice` is then its last price, where a
   * market order's price field starts.
   */
  editing?: PaperOrder;
  /** Called after a modify was sent, whether or not it was saved, so the order list can show what happened. */
  onModified?: () => void;
}

/** The fields a new order starts from: one lot at the premium clicked. */
const newOrderFields = (option: OrderOption, price: number): OrderTicketFields => ({
  quantity: option.lotSize, price, targetPrice: '', stopLossPrice: '', confidence: DEFAULT_CONFIDENCE, note: '',
});

const hasDetails = (fields: OrderTicketFields) => Boolean(fields.targetPrice || fields.stopLossPrice || fields.note);

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
const OrderModal: React.FC<OrderModalProps> = ({ option, initialPrice, priceLabel, choices, onClose, onToast, editing, onModified }) => {
  const [start] = useState(() => (editing ? pendingOrderFields(editing, initialPrice) : newOrderFields(option, initialPrice)));
  const [side, setSide] = useState<SideId>(editing?.side ?? Side.BUY);
  const [quantity, setQuantity] = useState(start.quantity);
  const [price, setPrice] = useState(start.price);
  const [showDetails, setShowDetails] = useState(hasDetails(start));
  const [targetPrice, setTargetPrice] = useState(start.targetPrice);
  const [stopLossPrice, setStopLossPrice] = useState(start.stopLossPrice);
  const [confidence, setConfidence] = useState(start.confidence);
  const [note, setNote] = useState(start.note);

  const isPaper = choices.mode === TradingMode.Paper;
  const isLimit = isPaper && choices.orderType === OrderType.Limit;
  const title = `${instrumentName({ instrumentType: option.optionType, tradingsymbol: option.tradingsymbol })} ${option.strike} ${option.optionType}`;
  const tradeLabel = `${side} ${option.strike}${option.optionType}`;
  const fields = { quantity, price, targetPrice, stopLossPrice, confidence, note };

  const place = async () => {
    try {
      const placed = await placeOrder(ticketOrder(option, side, fields, choices));
      onToast(placedOrderMessage(placed, tradeLabel), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
    } catch (err) {
      onToast(tradeErrorMessage(err, isLimit ? 'Failed to place order' : undefined), ToastColor.Red);
    }
  };

  const modify = async (order: PaperOrder) => {
    try {
      const modified = await modifyOrder(order.id, ticketChanges(fields, choices.orderType));
      onToast(modifiedOrderMessage(modified, tradeLabel), placedOrderRefused(modified) ? ToastColor.Red : ToastColor.Green);
    } catch (err) {
      onToast(tradeErrorMessage(err, 'Failed to modify order'), ToastColor.Red);
    }
    onModified?.();
  };

  const submit = async () => {
    await (editing ? modify(editing) : place());
    onClose();
  };

  return (
    <Modal
      title={<>{title} <span className="order-modal__expiry">· {formatCalendarDate(option.expiry, { day: 'numeric', month: 'short' })}</span></>}
      eyebrow={editing ? MODIFY_EYEBROW : undefined}
      subtitle={<>{priceLabel} ₹{formatAmount(initialPrice)}</>}
      onClose={onClose}
      className={`order-modal order-modal--${side.toLowerCase()}`}
      footer={isPaper ? (
        <button type="button" className={`order-modal__submit order-modal__submit--${side.toLowerCase()}`} onClick={submit}>
          {editing ? `${MODIFY_EYEBROW} ` : ''}{side} {quantity} @ {isLimit ? formatAmount(price) : 'MKT'}
        </button>
      ) : (
        <p className="order-modal__live-notice">Live trading coming soon. Use Paper mode to track positions.</p>
      )}
    >
      <div className="order-modal__body">
        <div className="order-modal__row">
          {isPaper && (
            <div className={`order-modal__side order-modal__side--${side.toLowerCase()}`}>
              <OrderModalSwitch label="Side" options={SIDE_OPTIONS} value={side} onChange={setSide} disabled={Boolean(editing)} />
            </div>
          )}
          {!editing && (
            <div className="order-modal__trading-mode">
              <OrderModalSwitch label="Trading mode" options={MODE_OPTIONS} value={choices.mode} onChange={choices.chooseMode} />
            </div>
          )}
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
                <OrderModalSwitch label="Trade type" options={HORIZON_OPTIONS} value={choices.horizon} onChange={choices.setHorizon} disabled={Boolean(editing)} />
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
    </Modal>
  );
};

export default OrderModal;
