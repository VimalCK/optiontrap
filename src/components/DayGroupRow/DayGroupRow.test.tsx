import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DayGroupRow from './DayGroupRow';

const row = (props: Partial<React.ComponentProps<typeof DayGroupRow>> = {}) => renderToStaticMarkup(
  <table><tbody>
    <DayGroupRow day="2026-11-16" count={3} noun="position" pnl={1172} pnlColumn={5} columns={7} expanded onToggle={() => {}} {...props} />
  </tbody></table>,
);
const cells = (markup: string) => [...markup.matchAll(/<(th|td)([^>]*)>/g)].map(([, tag, attrs]) => `${tag}${attrs}`);

describe('DayGroupRow', () => {
  it('shows the IST day, the count and the P&L under the P&L column', () => {
    const markup = row();
    expect(markup).toContain('Mon, 16 Nov, 2026');
    expect(markup).toContain(' · 3 positions');
    expect(markup).toContain('<td class="day-group-row__pnl day-group-row__pnl--profit">+1,172.00</td>');
    // 5 columns before P&L, then P&L, then the chevron: 7 in all, nothing left to fill.
    expect(cells(markup)).toEqual(['th scope="colgroup" colSpan="5"', 'td class="day-group-row__pnl day-group-row__pnl--profit"', 'td class="day-group-row__toggle"']);
  });

  it('fills the columns between the P&L and the chevron', () => {
    expect(cells(row({ pnlColumn: 6, columns: 9 }))).toContain('td colSpan="1"');
  });

  it('names one row in the singular, and shows a dash and a loss tone when it should', () => {
    expect(row({ count: 1, noun: 'trade', pnl: null })).toContain(' · 1 trade<');
    expect(row({ count: 1, noun: 'trade', pnl: null })).toContain('<td class="day-group-row__pnl">–</td>');
    expect(row({ pnl: -267 })).toContain('day-group-row__pnl--loss');
  });

  it("has a chevron that hides the day's rows, or shows them once folded", () => {
    const button = (markup: string) => markup.match(/<button[^>]*>/)?.[0] ?? '';
    expect(button(row())).toContain('aria-label="Hide this day&#x27;s positions"');
    expect(button(row())).toContain('aria-expanded="true"');
    const folded = row({ expanded: false });
    expect(folded).toContain('class="day-group-row day-group-row--collapsed"');
    expect(button(folded)).toContain('aria-label="Show this day&#x27;s positions"');
  });
});
