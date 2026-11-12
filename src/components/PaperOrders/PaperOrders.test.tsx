import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PaperOrders, { PaperOrdersTable, orderStatus, settledSince, pendingCount } from './PaperOrders';
import type { PaperOrder } from '@/services/orders';
import { Horizon } from '../../../shared/tradeEnums.js';
import { Tone } from '@/utils/uiEnums';

const order = (id: string, extra: Partial<PaperOrder> = {}): PaperOrder => ({
  id, tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO', strike: 24000,
  optionType: 'CE', expiry: '2026-11-10', side: 'BUY', quantity: 75, orderType: 'Limit', limitPrice: 50, status: 'Open', statusReason: null,
  fillPrice: null, positionId: null, closesPosition: false, source: 'Manual', horizon: Horizon.Intraday, autoTradeId: null, createdAt: '2026-11-05T06:30:00.000Z', updatedAt: '2026-11-05T06:30:00.000Z', ...extra, // Thu 12:00 IST
});

describe('orderStatus', () => {
  it('shows open, filled at its fill price, or why it was cancelled', () => {
    expect(orderStatus(order('a'))).toEqual({ tone: Tone.Accent, text: 'Open' });
    expect(orderStatus(order('a', { status: 'Filled', fillPrice: 49.5 }))).toEqual({ tone: Tone.Positive, text: 'Filled @ 49.50' });
    expect(orderStatus(order('a', { status: 'Cancelled', statusReason: 'Cancelled at market close' })))
      .toEqual({ tone: Tone.Neutral, text: 'Cancelled at market close' });
  });
});

describe('settledSince', () => {
  it('is true only when an order that was open has left the open list', () => {
    const before = new Set(['a']);
    expect(settledSince(before, [])).toBe(true); // filled or cancelled
    expect(settledSince(before, [order('b')])).toBe(true);
    expect(settledSince(before, [order('a')])).toBe(false);
    expect(settledSince(before, [order('a'), order('b')])).toBe(false); // a new one is not a fill
    expect(settledSince(new Set(), [])).toBe(false);
  });
});

describe('PaperOrdersTable', () => {
  const html = renderToStaticMarkup(
    <PaperOrdersTable orders={[order('a'), order('b', { status: 'Filled', fillPrice: 50, side: 'SELL' })]} onCancel={() => {}} />,
  );

  it('lists each order with its instrument, IST time, side, quantity, limit and status', () => {
    expect(html).toContain('<span class="positions-table__name">NIFTY</span>');
    expect(html).toContain('<td>12:00</td>');
    expect(html).toContain('positions-table__side--sell');
    expect(html).toContain('<td>50.00</td>');
    expect(html).toContain('Filled @ 50.00');
  });

  it('says who placed each order, Auto or Manual, like its position', () => {
    const auto = renderToStaticMarkup(<PaperOrdersTable orders={[order('c', { source: 'Auto', autoTradeId: 't1' })]} onCancel={() => {}} />);
    expect(auto).toContain('>Auto</span>');
    expect(auto).not.toContain('>Manual</span>');
    expect(html.match(/>Manual<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain('>Auto</span>');
  });

  it('shows Market in the Limit column for a market order', () => {
    const market = renderToStaticMarkup(<PaperOrdersTable orders={[order('m', { orderType: 'Market', limitPrice: null, horizon: Horizon.Positional })]} onCancel={() => {}} />);
    expect(market).toContain('<td>Market</td>');
  });

  it('offers Cancel only on open orders', () => {
    expect(html.match(/title="Cancel order"/g)).toHaveLength(1);
    const button = html.match(/<button[^>]*title="Cancel order"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('type="button"');
  });
});

describe('pendingCount', () => {
  it('counts only the orders still waiting to fill', () => {
    expect(pendingCount([order('a'), order('b', { status: 'Filled' }), order('c', { status: 'Cancelled' }), order('d')])).toBe(2);
    expect(pendingCount([])).toBe(0);
  });
});

describe('PaperOrders', () => {
  const closed = [order('f', { status: 'Filled', fillPrice: 50 }), order('c', { status: 'Cancelled', statusReason: 'Cancelled at market close' })];

  it('lists only the orders still waiting to fill, not those filled or cancelled today', () => {
    const html = renderToStaticMarkup(<PaperOrders orders={[order('a'), ...closed]} error={null} onCancel={() => {}} />);
    expect(html.match(/title="Cancel order"/g)).toHaveLength(1);
    expect(html).not.toContain('Filled @');
    expect(html).not.toContain('Cancelled at market close');
  });

  it('shows the empty state when nothing is pending, and the error when loading failed', () => {
    const html = renderToStaticMarkup(<PaperOrders orders={closed} error="Failed to load orders" onCancel={() => {}} />);
    expect(html).toContain('No pending orders');
    expect(html).toContain('Failed to load orders');
    expect(html).not.toContain('positions-table');
  });
});
