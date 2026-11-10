import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DateInput, { DateCalendar } from './DateInput';

const noop = () => {};

describe('DateInput', () => {
  it('shows the picked date day, month, year', () => {
    const html = renderToStaticMarkup(<DateInput label="From" value="2026-11-03" onChange={noop} />);
    expect(html).toContain('03-11-2026');
    expect(html).toContain('aria-label="From: 03-11-2026"');
  });

  it('shows a day-first placeholder when no date is picked', () => {
    const html = renderToStaticMarkup(<DateInput label="To" value="" onChange={noop} />);
    expect(html).toContain('DD-MM-YYYY');
    expect(html).toContain('aria-label="To: no date picked"');
  });
});

describe('DateCalendar', () => {
  const html = renderToStaticMarkup(
    <DateCalendar month={{ year: 2026, month: 11 }} value="2026-11-03" min="2026-11-02" max="2026-11-05" today="2026-11-04"
      onPick={noop} onMonthChange={noop} onClear={noop} />,
  );
  const day = (date: string) => html.match(new RegExp(`<button[^>]*aria-label="${date}"[^>]*>`))?.[0] ?? '';

  it('titles the month and marks the picked day and today', () => {
    expect(html).toContain('November 2026');
    expect(day('03-11-2026')).toContain('date-input__day--selected');
    expect(day('04-11-2026')).toContain('date-input__day--today');
  });

  it('disables days before min and after max only', () => {
    expect(day('01-11-2026')).toContain('disabled');
    expect(day('06-11-2026')).toContain('disabled');
    expect(day('02-11-2026')).not.toContain('disabled');
    expect(day('05-11-2026')).not.toContain('disabled');
  });
});
