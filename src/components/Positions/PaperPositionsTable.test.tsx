import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PaperPositionsTable from './PaperPositionsTable';
import type { Position } from '@/services/positions';

const position = (id: string, entryTime: string, extra: Partial<Position> = {}): Position => ({
  id, tradingsymbol: `NIFTY26N1725${id}PE`, instrumentToken: Number(id), strike: 25000, optionType: 'PE', expiry: '2026-11-24',
  side: 'SELL', quantity: 65, entryPrice: 80, entryTime, exited: true, exitPrice: 70, exitTime: '2026-11-17T09:00:00.000Z',
  mode: 'Paper', instrumentType: 'PE', exchange: 'NFO', source: 'Auto', strategyId: 'a', horizon: 'Intraday', ...extra,
} as Position);

const dayHeadings = (markup: string) => [...markup.matchAll(/<tr class="day-group-row"><th[^>]*>([^<]+)<span[^>]*>([^<]+)<\/span><\/th><td[^>]*>([^<]+)</g)]
  .map(([, day, count, pnl]) => [day, count, pnl]);

describe('PaperPositionsTable', () => {
  it('groups positions by the IST day they were opened, newest first, so one opened yesterday and closed today sits under yesterday', () => {
    const positions = [
      position('100', '2026-11-17T06:51:00.000Z'), // Tue 12:21 IST
      position('200', '2026-11-16T07:20:00.000Z', { exitPrice: 81.85 }), // Mon 12:50 IST, closed on Tue
      position('300', '2026-11-16T18:40:00.000Z'), // Tue 00:10 IST: already Tuesday in India
    ];
    const markup = renderToStaticMarkup(<MemoryRouter><PaperPositionsTable positions={positions} livePrices={new Map()} onExit={() => {}} /></MemoryRouter>);
    expect(dayHeadings(markup)).toEqual([
      ['Tue, 17 Nov, 2026', ' · 2 positions', '+1,300.00'],
      ['Mon, 16 Nov, 2026', ' · 1 position', '-120.25'],
    ]);
    expect(markup.match(/<tbody>/g)).toHaveLength(2);
  });

  it('shows when each position was entered, in IST, on the line under its instrument', () => {
    const open = position('100', '2026-11-18T08:49:22.000Z', { exited: false, exitPrice: undefined }); // Wed 14:19 IST
    const markup = renderToStaticMarkup(<MemoryRouter><PaperPositionsTable positions={[open]} livePrices={new Map()} onExit={() => {}} /></MemoryRouter>);
    expect(markup).toContain('<span class="positions-table__labels"><span class="positions-table__detail">14:19</span>');
  });

  it("shows an exited position's live LTP under its exit price, keeping its P&L at the exit", () => {
    const markup = renderToStaticMarkup(<MemoryRouter><PaperPositionsTable positions={[position('100', '2026-11-17T06:51:00.000Z')]} livePrices={new Map([[100, 64.5]])} onExit={() => {}} /></MemoryRouter>);
    expect(markup).toContain('70.00<span class="positions-table__pct">LTP 64.50</span>');
    expect(dayHeadings(markup)).toEqual([['Tue, 17 Nov, 2026', ' · 1 position', '+650.00']]);
  });

  it("shows two strategies' open positions in one instrument as one row, the legs folded under it", () => {
    const open = { exited: false, exitPrice: undefined };
    const positions = [
      position('100', '2026-11-17T06:51:00.000Z', { ...open, quantity: 65, entryPrice: 80 }),
      position('100', '2026-11-17T06:55:00.000Z', { ...open, id: '101', strategyId: 'b', quantity: 130, entryPrice: 86 }),
    ];
    const markup = renderToStaticMarkup(<MemoryRouter><PaperPositionsTable positions={positions} livePrices={new Map([[100, 75]])} onExit={() => {}} /></MemoryRouter>);
    // 65 × (80 − 75) + 130 × (86 − 75) = 325 + 1,430
    expect(dayHeadings(markup)).toEqual([['Tue, 17 Nov, 2026', ' · 1 position', '+1,755.00']]);
    expect(markup).toContain('<td class="table-num">195</td><td class="table-num">84.00</td>');
    expect(markup).toContain('2 strategies');
    expect(markup).not.toContain('positions-table__row--leg');
  });

  it("prices an open position's day at its live price", () => {
    const open = position('100', '2026-11-17T06:51:00.000Z', { exited: false, exitPrice: undefined });
    const markup = renderToStaticMarkup(<MemoryRouter><PaperPositionsTable positions={[open]} livePrices={new Map([[100, 75]])} onExit={() => {}} /></MemoryRouter>);
    expect(dayHeadings(markup)).toEqual([['Tue, 17 Nov, 2026', ' · 1 position', '+325.00']]);
  });
});
