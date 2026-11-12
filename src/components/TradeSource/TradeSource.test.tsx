import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TradeSource from './TradeSource';

describe('TradeSource', () => {
  it('shows Auto for a trade the automation placed', () => {
    expect(renderToStaticMarkup(<TradeSource source="Auto" />))
      .toBe('<span class="trade-source trade-source--auto" title="Placed by the trade automation">Auto</span>');
  });

  it('shows Manual for a trade placed by hand', () => {
    expect(renderToStaticMarkup(<TradeSource source="Manual" />))
      .toBe('<span class="trade-source trade-source--manual" title="Placed by hand">Manual</span>');
  });
});
