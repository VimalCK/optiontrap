import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Shimmer, { ShimmerGroup, ShimmerTableRows, ShimmerText } from './Shimmer';
import { ShimmerShape } from '@/utils/uiEnums';

const openingTag = (markup: string, className: string) => markup.match(new RegExp(`<[a-z]+ [^>]*class="${className}[" ][^>]*>`))?.[0] ?? '';

describe('Shimmer', () => {
  it('is a line of text by default, hidden from screen readers', () => {
    const tag = openingTag(renderToStaticMarkup(<Shimmer />), 'shimmer');
    expect(tag).toContain('class="shimmer shimmer--text"');
    expect(tag).toContain('aria-hidden="true"');
  });

  it('takes its shape, a page class, and a size in pixels or any CSS length', () => {
    const tag = openingTag(renderToStaticMarkup(<Shimmer shape={ShimmerShape.Circle} width={118} height="4em" className="x" />), 'shimmer');
    expect(tag).toContain('class="shimmer shimmer--circle x"');
    expect(tag).toContain('width:118px');
    expect(tag).toContain('height:4em');
  });
});

describe('ShimmerText', () => {
  it('shows a placeholder while loading, then the value', () => {
    const loading = renderToStaticMarkup(<ShimmerText loading width="5em">₹1.2L</ShimmerText>);
    expect(loading).toContain('width:5em');
    expect(loading).not.toContain('₹1.2L');
    expect(renderToStaticMarkup(<ShimmerText loading={false}>₹1.2L</ShimmerText>)).toBe('₹1.2L');
  });
});

describe('ShimmerTableRows', () => {
  it('fills the body with rows of placeholder cells, one per column', () => {
    const markup = renderToStaticMarkup(<table><tbody><ShimmerTableRows rows={3} columns={7} /></tbody></table>);
    expect(markup.match(/<tr /g)).toHaveLength(3);
    expect(markup.match(/<td>/g)).toHaveLength(21);
    expect(markup.match(/class="shimmer shimmer--text"/g)).toHaveLength(21);
  });

  it("gives each cell the table's own cell class when it has one", () => {
    const markup = renderToStaticMarkup(<table><tbody><ShimmerTableRows rows={1} columns={2} cellClassName="wl-table__td" /></tbody></table>);
    expect(markup.match(/<td class="wl-table__td">/g)).toHaveLength(2);
  });
});

describe('ShimmerGroup', () => {
  it('announces the area as busy, by its label', () => {
    const markup = renderToStaticMarkup(<ShimmerGroup label="Loading holdings" className="list"><Shimmer /></ShimmerGroup>);
    const tag = openingTag(markup, 'shimmer-group');
    expect(tag).toContain('class="shimmer-group list"');
    expect(tag).toContain('role="status"');
    expect(tag).toContain('aria-busy="true"');
    expect(markup).toContain('<span class="shimmer-group__label">Loading holdings</span>');
  });
});
