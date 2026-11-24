import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavStateDot } from './Sidebar';

describe('NavStateDot', () => {
  it("shows whether the entry's feature is on or off as a green or red dot, with no text", () => {
    expect(renderToStaticMarkup(<NavStateDot label="Algo Trading" on />))
      .toBe('<span class="sidebar__state-dot sidebar__state-dot--on" role="img" aria-label="Algo Trading on" title="Algo Trading on"></span>');
    expect(renderToStaticMarkup(<NavStateDot label="Algo Trading" on={false} />))
      .toBe('<span class="sidebar__state-dot sidebar__state-dot--off" role="img" aria-label="Algo Trading off" title="Algo Trading off"></span>');
  });

  it('shows nothing for an entry with no state, or before it is known', () => {
    expect(renderToStaticMarkup(<NavStateDot label="Dashboard" on={null} />)).toBe('');
  });
});
