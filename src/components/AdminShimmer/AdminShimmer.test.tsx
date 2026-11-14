import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminTableRowsShimmer, ServiceRowsShimmer } from './AdminShimmer';

const count = (html: string, text: string) => html.split(text).length - 1;

describe('AdminTableRowsShimmer', () => {
  it('draws the rows and cells asked for, in the admin table row layout', () => {
    const html = renderToStaticMarkup(<AdminTableRowsShimmer rows={3} columns={4} />);
    expect(count(html, 'class="admin-table__row"')).toBe(3);
    expect(count(html, 'class="admin-cell"')).toBe(12);
  });
});

describe('ServiceRowsShimmer', () => {
  it('draws each service row with an icon tile, two lines and a badge', () => {
    const html = renderToStaticMarkup(<ServiceRowsShimmer rows={2} />);
    expect(count(html, 'class="hx-service"')).toBe(2);
    expect(count(html, 'admin-shimmer__icon')).toBe(2);
    expect(count(html, 'admin-shimmer__badge')).toBe(2);
  });
});
