import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaperOrdersTable, filledSince, orderStatus } from './PaperOrders';
import type { PaperOrder } from '@/services/paperOrders';

const order = (id: string, extra: Partial<PaperOrder> = {}): PaperOrder => ({
  id, tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO', strike: 24000,
  optionType: 'CE', expiry: '2026-11-10', side: 'BUY', quantity: 75, limitPrice: 50, status: 'open', statusReason: null,
  fillPrice: null, positionId: null, source: 'manual', autoTradeId: null, createdAt: '2026-11-05T06:30:00.000Z', updatedAt: '2026-11-05T06:30:00.000Z', ...extra, // Thu 12:00 IST
});

describe('orderStatus', () => {
  it('shows open, filled at its fill price, or why it was cancelled', () => {
    expect(orderStatus(order('a'))).toEqual({ tone: 'accent', text: 'Open' });
    expect(orderStatus(order('a', { status: 'filled', fillPrice: 49.5 }))).toEqual({ tone: 'positive', text: 'Filled @ 49.50' });
    expect(orderStatus(order('a', { status: 'cancelled', statusReason: 'Cancelled at market close' })))
      .toEqual({ tone: 'neutral', text: 'Cancelled at market close' });
  });
});

describe('filledSince', () => {
  it('is true only when an order that was open is filled now', () => {
    const before = new Set(['a']);
    expect(filledSince(before, [order('a', { status: 'filled' })])).toBe(true);
    expect(filledSince(before, [order('a')])).toBe(false);
    expect(filledSince(before, [order('a', { status: 'cancelled' })])).toBe(false);
    expect(filledSince(before, [order('b', { status: 'filled' })])).toBe(false); // filled before it was seen open
  });
});

describe('PaperOrdersTable', () => {
  const html = renderToStaticMarkup(
    <PaperOrdersTable orders={[order('a'), order('b', { status: 'filled', fillPrice: 50, side: 'SELL' })]} onCancel={() => {}} />,
  );

  it('lists each order with its instrument, IST time, side, quantity, limit and status', () => {
    expect(html).toContain('<span class="positions-table__name">NIFTY</span>');
    expect(html).toContain('<td>12:00</td>');
    expect(html).toContain('positions-table__side--sell');
    expect(html).toContain('<td>50.00</td>');
    expect(html).toContain('Filled @ 50.00');
  });

  it('tags an order the trade automation placed as Auto, like its position', () => {
    const auto = renderToStaticMarkup(<PaperOrdersTable orders={[order('c', { source: 'auto', autoTradeId: 't1' })]} onCancel={() => {}} />);
    expect(auto).toContain('<span class="positions-table__source" title="Placed by the trade automation">Auto</span>');
    expect(html).not.toContain('positions-table__source');
  });

  it('offers Cancel only on open orders', () => {
    expect(html.match(/title="Cancel order"/g)).toHaveLength(1);
    const button = html.match(/<button[^>]*title="Cancel order"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('type="button"');
  });
});
