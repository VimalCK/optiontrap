import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TradeJournal from './TradeJournal';
import { TradingMode } from '../../../shared/tradeEnums.js';

// A static render runs no effects: it is the page before the first report's fetch delay has passed.
describe('TradeJournal before the first report arrives', () => {
  it('shows the Trade Log card and the heatmap stats as loading, not empty', () => {
    const html = renderToStaticMarkup(<TradeJournal initialMode={TradingMode.Paper} />);

    expect(html).toContain('Trade Log');
    expect(html).toContain('shimmer');
  });

  it('shows no Trade Log in Live mode, which fetches no report', () => {
    const html = renderToStaticMarkup(<TradeJournal initialMode={TradingMode.Live} />);

    expect(html).not.toContain('Trade Log');
  });
});
