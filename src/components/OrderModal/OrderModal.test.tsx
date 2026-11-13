import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderModal from './OrderModal';
import type { OrderChoices } from './useOrderChoices';
import { Horizon, OptionType, OrderType, TradingMode, type OrderTypeId, type TradingModeId } from '../../../shared/tradeEnums.js';

const option = { tradingsymbol: 'NIFTY26NOV24000PE', instrumentToken: 222, lotSize: 75, strike: 24000, optionType: OptionType.PE, expiry: '2026-11-26' };
const choices = (mode: TradingModeId, orderType: OrderTypeId): OrderChoices => ({
  mode, chooseMode: () => {}, orderType, setOrderType: () => {}, horizon: Horizon.Positional, setHorizon: () => {},
});
const render = (mode: TradingModeId, orderType: OrderTypeId = OrderType.Limit) => renderToStaticMarkup(
  <OrderModal option={option} initialPrice={88.25} priceLabel="Day close" choices={choices(mode, orderType)} onClose={() => {}} onToast={() => {}} />,
);
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
});
