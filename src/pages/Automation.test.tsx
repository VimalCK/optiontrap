import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Automation, { AUTOMATION_PARTS } from './Automation';

const titles = (html: string) => [...html.matchAll(/class="card__title automation-part__title">([^<]+)</g)].map((m) => m[1]);
const badges = (html: string) => [...html.matchAll(/automation-part__badge--[\w-]+">([^<]+)</g)].map((m) => m[1]);

describe('Automation page', () => {
  const html = renderToStaticMarkup(<Automation />);

  it('shows one panel per part of the plan, in build order', () => {
    expect(titles(html)).toEqual(['Signal engine', 'Paper execution', 'Trade monitor', 'Risk limits', 'Scorecard']);
  });

  it('numbers the steps 1 to 5', () => {
    expect([...html.matchAll(/automation-part__step">(\d)</g)].map((m) => m[1])).toEqual(['1', '2', '3', '4', '5']);
  });

  it('marks every part as coming next, and says nothing is running yet', () => {
    expect(badges(html)).toEqual(Array(5).fill('Coming next'));
    expect(html).toContain('not running yet');
  });

  it('lists every point of each part', () => {
    for (const point of AUTOMATION_PARTS.flatMap((part) => part.points)) {
      expect(html).toContain(`<li>${point}</li>`);
    }
  });
});
