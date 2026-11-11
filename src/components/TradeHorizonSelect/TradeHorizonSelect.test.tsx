import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TradeHorizonSelect from './TradeHorizonSelect';
import { Horizon } from '../../../shared/horizons.js';
import { storedTradeHorizon } from '@/hooks/useTradeHorizon';

describe('TradeHorizonSelect', () => {
  it('shows the chosen horizon, with what each one means as its tooltip', () => {
    const html = renderToStaticMarkup(<TradeHorizonSelect value={Horizon.Positional} onChange={() => {}} />);
    expect(html).toContain('Positional');
    expect(html).toContain('positional trades can be placed any time and fill in market hours');
  });
});

describe('storedTradeHorizon', () => {
  it('is intraday when nothing can be read from storage', () => {
    expect(storedTradeHorizon()).toBe(Horizon.Intraday);
  });
});
