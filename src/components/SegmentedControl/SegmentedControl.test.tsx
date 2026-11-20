import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SegmentedControl from './SegmentedControl';
import { Tone } from '@/utils/uiEnums';

describe('SegmentedControl', () => {
  const html = renderToStaticMarkup(
    <SegmentedControl
      label="Position"
      value="Sell"
      onChange={() => {}}
      options={[{ id: 'Sell', label: 'Sell', tone: Tone.Negative }, { id: 'Buy', label: 'Buy' }]}
    />,
  );

  it('names the group and renders one button per option', () => {
    expect(html).toMatch(/<div class="segmented" role="group" aria-label="Position">/);
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
  });

  it('marks only the chosen option, in its tone', () => {
    expect(html).toMatch(/<button[^>]*class="segmented__option segmented__option--active segmented__option--negative"[^>]*aria-pressed="true"[^>]*>Sell</);
    expect(html).toMatch(/<button[^>]*class="segmented__option"[^>]*aria-pressed="false"[^>]*>Buy</);
  });
});
