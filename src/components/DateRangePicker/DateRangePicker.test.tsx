import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DateRangePicker from './DateRangePicker';

describe('DateRangePicker', () => {
  const html = renderToStaticMarkup(<DateRangePicker range={{ from: '2026-11-01', to: '2026-11-05' }} onChange={() => {}} />);
  const picker = (label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}: [^"]*"[^>]*>.*?</button>`))?.[0] ?? '';

  it('shows the range picked, day first', () => {
    expect(picker('From')).toContain('01-11-2026');
    expect(picker('To')).toContain('05-11-2026');
  });

  it('has only the two date pickers, no shortcut buttons', () => {
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});
