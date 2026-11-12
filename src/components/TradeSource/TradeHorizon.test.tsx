import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TradeHorizon from './TradeHorizon';
import { Horizon } from '../../../shared/tradeEnums.js';

describe('TradeHorizon', () => {
  it('names the horizon by its label', () => {
    expect(renderToStaticMarkup(<TradeHorizon horizon={Horizon.Intraday} />))
      .toBe('<span class="trade-source trade-source--horizon" title="Trade type">Intraday</span>');
    expect(renderToStaticMarkup(<TradeHorizon horizon={Horizon.Positional} />)).toContain('>Positional</span>');
  });
});
