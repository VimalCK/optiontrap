import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DateRangePicker from './DateRangePicker';

describe('DateRangePicker', () => {
  const html = renderToStaticMarkup(<DateRangePicker range={{ from: '2026-11-01', to: '2026-11-05' }} onChange={() => {}} />);
  const input = (label: string) => html.match(new RegExp(`${label}<input[^>]*>`))?.[0] ?? '';

  it("shows the range picked, and won't let To go before From", () => {
    expect(input('From')).toContain('value="2026-11-01"');
    expect(input('From')).toContain('max="2026-11-05"');
    expect(input('To')).toContain('value="2026-11-05"');
    expect(input('To')).toContain('min="2026-11-01"');
  });

  it('has only the two date pickers, no shortcut buttons', () => {
    expect(html).not.toContain('<button');
  });
});
