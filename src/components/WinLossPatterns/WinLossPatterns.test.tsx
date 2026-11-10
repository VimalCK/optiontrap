import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsView } from './WinLossPatterns';
import type { AutoTradeResults, ResultGroup } from '@/services/automation';

const group = <K,>(key: K, pnl: number, extra: Partial<ResultGroup<K>> = {}): ResultGroup<K> => ({
  key, trades: 2, wins: 1, losses: 1, pnl, grossProfit: 1500, grossLoss: 1500, best: 1500, worst: -1500, charges: 0, ...extra,
});

const results: AutoTradeResults = {
  summary: group(null, 500, { trades: 3, wins: 2, grossProfit: 2000 }),
  maxDrawdown: 1500,
  byStrategy: [group('option-analyzer-setups', 500)],
  bySetup: [group('Long call', 1500), group('Bull put', -1000)],
  byExitRule: [group('target', 1500), group(null, 500), group('stop-loss', -1500)],
  byEntrySlot: [group(570, 0), group(810, 500)],
  bySide: [group('BUY', 1500), group('SELL', -1000)],
  byDay: [group('2026-11-09', 0), group('2026-11-10', 500)],
};

describe('ResultsView', () => {
  const html = renderToStaticMarkup(<ResultsView results={results} />);
  const cells = (text: string) => html.match(new RegExp(`<tr><td>${text}</td>.*?</tr>`))?.[0] ?? '';

  it('leads with total P&L, win rate, profit factor and drawdown, each with what it means', () => {
    expect(html).toMatch(/Total P&amp;L<\/span><span class="winloss-kpi__value winloss--profit">\+500.00<\/span><span class="winloss-kpi__note">3 closed trades/);
    expect(html).toMatch(/Win rate<\/span><span class="winloss-kpi__value ">66.7%/);
    expect(html).toContain('2 won · 1 lost');
    expect(html).toMatch(/Profit factor<\/span><span class="winloss-kpi__value ">1.33/);
    expect(html).toMatch(/Max drawdown<\/span><span class="winloss-kpi__value winloss--loss">-1,500.00/);
  });

  it('draws wins against losses as a bar: two of three won, one lost', () => {
    const bar = html.match(/<span class="winloss-bar"[^>]*>.*?<\/span><\/span>/)?.[0] ?? '';
    expect(bar).toContain('<span class="winloss-bar__wins" style="width:66.66666666666666%">');
    expect(bar).toContain('<span class="winloss-bar__losses" style="width:33.33333333333333%">');
  });

  it('names each group plainly, with its P&L in profit or loss colour', () => {
    expect(cells('Option Analyzer setups')).toContain('+500.00');
    expect(cells('Bull put')).toContain('<td class="winloss--loss">-1,000.00</td>');
    expect(cells('Exited manually')).toContain('<td class="winloss--profit">+500.00</td>');
    expect(cells('Stop-loss')).toContain('50.0%');
    expect(cells('09:30–10:00')).toContain('<td class="">+0.00</td>');
    expect(cells('Sell')).toContain('-1,000.00');
  });

  it('draws each day as a bar from the zero line, with its figures on hover', () => {
    expect(html).toContain('title="Tue, 10 Nov\nP&amp;L +500.00 · 2 trades\nRunning total +500.00"');
    expect(html).toContain('<span class="winloss-chart__bar winloss-chart__bar--profit" style="height:100%"></span>');
  });

  it('gives each day its running total in the table view', () => {
    expect(cells('Tue, 10 Nov')).toMatch(/\+500.00<\/td><td class="winloss--profit">\+500.00<\/td><\/tr>$/);
  });
});
