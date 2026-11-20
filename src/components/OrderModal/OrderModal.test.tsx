import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderModal from './OrderModal';
import type { OrderChoices } from './useOrderChoices';
import type { PaperOrder } from '@/services/orders';
import { Horizon, OptionType, OrderStatus, OrderType, Side, TradeSource, TradingMode, type OrderTypeId, type TradingModeId } from '../../../shared/tradeEnums.js';

const option = { tradingsymbol: 'NIFTY26NOV24000PE', instrumentToken: 222, lotSize: 75, strike: 24000, optionType: OptionType.PE, expiry: '2026-11-26' };
const choices = (mode: TradingModeId, orderType: OrderTypeId): OrderChoices => ({
  mode, chooseMode: () => {}, orderType, setOrderType: () => {}, horizon: Horizon.Positional, setHorizon: () => {},
});
const render = (mode: TradingModeId, orderType: OrderTypeId = OrderType.Limit) => renderToStaticMarkup(
  <OrderModal option={option} initialPrice={88.25} priceLabel="Day close" choices={choices(mode, orderType)} onClose={() => {}} onToast={() => {}} />,
);
const pending = (extra: Partial<PaperOrder> = {}): PaperOrder => ({
  id: 'o1', tradingsymbol: 'NIFTY26NOV24000PE', instrumentToken: 222, instrumentType: OptionType.PE, exchange: 'NFO', strike: 24000,
  optionType: OptionType.PE, expiry: '2026-11-26', side: Side.SELL, quantity: 150, orderType: OrderType.Limit, limitPrice: 55, status: OrderStatus.Open,
  statusReason: null, fillPrice: null, positionId: null, closesPosition: false, note: 'fade the spike', targetPrice: 40, stopLossPrice: null,
  confidence: 60, source: TradeSource.Manual, horizon: Horizon.Intraday, autoTradeId: null,
  createdAt: '2026-11-05T06:30:00.000Z', updatedAt: '2026-11-05T06:30:00.000Z', // Thu 12:00 IST
  ...extra,
});
const pressed = (html: string, group: string) => html.match(new RegExp(`aria-label="${group}"[\\s\\S]*?aria-pressed="true"[^>]*>([^<]*)<`))?.[1];

describe('OrderModal', () => {
  it('names the contract and the premium it starts from', () => {
    const html = render(TradingMode.Paper);
    expect(html).toContain('NIFTY 24000 PE');
    expect(html).toContain('26 Nov');
    expect(html).toContain('Day close ₹88.25');
  });

  it('starts as a buy of one lot at the premium, with the page\'s order and trade type', () => {
    const html = render(TradingMode.Paper);
    expect(pressed(html, 'Side')).toBe('Buy');
    expect(pressed(html, 'Order type')).toBe('Limit');
    expect(pressed(html, 'Trade type')).toBe('Positional');
    expect(html).toMatch(/<input[^>]*value="75"/);
    expect(html).toMatch(/<input[^>]*value="88.25"/);
    expect(html).toMatch(/order-modal__submit--buy[^>]*>BUY 75 @ 88.25</);
  });

  it('leaves a market order\'s price empty and locked, as it fills at the market', () => {
    const html = render(TradingMode.Paper, OrderType.Market);
    const priceInput = html.match(/<input[^>]*aria-label="Price"[^>]*>/)?.[0] ?? '';
    expect(priceInput).toContain('disabled');
    expect(priceInput).toContain('value=""');
    expect(priceInput).toContain('placeholder="At market"');
    expect(html).toMatch(/>BUY 75 @ MKT</);
  });

  it('lets a limit order\'s price be edited, starting at the premium', () => {
    const priceInput = render(TradingMode.Paper).match(/<input[^>]*aria-label="Limit price"[^>]*>/)?.[0] ?? '';
    expect(priceInput).not.toContain('disabled');
    expect(priceInput).toContain('value="88.25"');
  });

  it('keeps target, stop-loss and note folded away until asked for', () => {
    const html = render(TradingMode.Paper);
    expect(html).toMatch(/aria-expanded="false"[^>]*>[\s\S]*?Add target, stop-loss, note/);
    expect(html).not.toContain('Stop-loss</span>');
  });

  it('in live mode only says live trading is not available yet', () => {
    const html = render(TradingMode.Live);
    expect(html).not.toContain('aria-label="Side"');
    expect(html).not.toContain('order-modal__submit');
    expect(html).toContain('Live trading coming soon');
  });

  describe('modifying a pending order', () => {
    const renderModify = (order: PaperOrder, orderType: OrderTypeId = order.orderType) => renderToStaticMarkup(
      <OrderModal option={option} initialPrice={61.4} priceLabel="LTP" choices={choices(TradingMode.Paper, orderType)} editing={order}
        onClose={() => {}} onToast={() => {}} />,
    );
    const group = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[\\s\\S]*?</div>`))?.[0] ?? '';

    it('starts from the order: its side, quantity, limit, and its target and note shown', () => {
      const html = renderModify(pending());
      expect(pressed(html, 'Side')).toBe('Sell');
      expect(html).toMatch(/<input[^>]*value="150"/);
      expect(html).toMatch(/<input[^>]*aria-label="Limit price"[^>]*value="55"|<input[^>]*value="55"[^>]*aria-label="Limit price"/);
      expect(html).toMatch(/<input[^>]*value="40"/);
      expect(html).toContain('fade the spike');
      expect(html).toContain('Confidence: 60%');
    });

    it('keeps the side and trade type as placed, and offers no trading mode', () => {
      const html = renderModify(pending());
      expect(group(html, 'Side').match(/<button[^>]*>/g)?.every((button) => button.includes('disabled'))).toBe(true);
      expect(group(html, 'Trade type').match(/<button[^>]*>/g)?.every((button) => button.includes('disabled'))).toBe(true);
      expect(group(html, 'Order type')).not.toContain('disabled');
      expect(html).not.toContain('aria-label="Trading mode"');
    });

    it('says it modifies the order, in the title and on the button', () => {
      const html = renderModify(pending());
      expect(html).toContain('>Modify</span>');
      expect(html).toMatch(/order-modal__submit--sell[^>]*>Modify SELL 150 @ 55.00</);
    });

    it("starts a market order's price at its last price, for a switch to limit", () => {
      expect(renderModify(pending({ orderType: OrderType.Market, limitPrice: null }), OrderType.Limit)).toMatch(/<input[^>]*value="61.4"/);
    });
  });
});
