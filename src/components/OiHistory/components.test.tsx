import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FuturesHistoryRow, OiCellData, OiTableRow, StrikeHistoryEntry, TradeSignalRow } from './types';
import { FuturesContext } from './FuturesContext';
import { OiSnapshotTable } from './OiSnapshotTable';
import { StrikeOiChart } from './StrikeOiChart';
import { SignalResultsGrid } from './TradeSetupDashboard';

const futuresRow = (date: string, expiry: string, close: number, oi: number): FuturesHistoryRow => ({
  date,
  instrumentToken: expiry === '2026-10-27' ? 1 : 2,
  tradingsymbol: expiry === '2026-10-27' ? 'NIFTY26OCTFUT' : 'NIFTY26NOVFUT',
  expiry,
  open: close,
  high: close,
  low: close,
  close,
  volume: 5000,
  oi,
});

const cell = (overrides: Partial<OiCellData>): OiCellData => ({
  ceOi: 0, peOi: 0,
  cePrevOi: undefined, pePrevOi: undefined,
  ceClose: 0, peClose: 0,
  cePrevClose: undefined, pePrevClose: undefined,
  ceToken: undefined, peToken: undefined,
  ceTradingsymbol: undefined, peTradingsymbol: undefined,
  ceExpiry: undefined, peExpiry: undefined,
  ...overrides,
});

describe('FuturesContext', () => {
  it('renders nothing without futures data', () => {
    expect(renderToStaticMarkup(<FuturesContext futuresData={[]} filterDate="2026-10-23" scrip="NIFTY50" />)).toBe('');
  });

  it('shows each month for the selected date with its signal', () => {
    const html = renderToStaticMarkup(
      <FuturesContext
        futuresData={[
          futuresRow('2026-10-22', '2026-10-27', 22400, 1000),
          futuresRow('2026-10-23', '2026-10-27', 22500, 1100),
          futuresRow('2026-10-22', '2026-11-24', 22500, 500),
          futuresRow('2026-10-23', '2026-11-24', 22450, 600),
        ]}
        filterDate="2026-10-23"
        scrip="NIFTY50"
      />,
    );
    expect(html).toContain('Futures Context');
    expect(html).toContain('October 2026');
    expect(html).toContain('November 2026');
    expect(html).toContain('Long buildup');
    expect(html).toContain('Short buildup');
  });
});

describe('OiSnapshotTable', () => {
  const rows: OiTableRow[] = [
    {
      strike: 22500,
      cells: new Map([['2026-10-27', cell({ ceOi: 1_900_000, cePrevOi: 1_000_000, ceClose: 120, ceToken: 11, peOi: 500_000, peClose: 80, peToken: 12 })]]),
      cePattern: 'Long Buildup',
      pePattern: 'Stable',
      ceConsolidatedOi: 1_900_000,
      peConsolidatedOi: 500_000,
      dimmed: false,
    },
  ];

  it('renders strikes, OI change, patterns and trade buttons', () => {
    const html = renderToStaticMarkup(
      <OiSnapshotTable
        rows={rows}
        expiries={['2026-10-27']}
        isMonthlyExpiry={() => true}
        filterDate="2026-10-23"
        atmStrike={22500}
        spotClose={22450}
        maxConsolidatedOi={1_900_000}
        selectedStrike={22500}
        onSelectStrike={() => {}}
        onTrade={() => {}}
      />,
    );
    expect(html).toContain('OI Snapshot');
    expect(html).toContain('22500');
    expect(html).toContain('1.9M (+90%)');
    expect(html).toContain('Long Buildup');
    expect(html).toContain('Oct 27 (M)');
    expect(html).toContain('oi-history__row--atm');
    expect(html.match(/oi-history__action-btn--buy/g)).toHaveLength(2);
  });
});

describe('StrikeOiChart', () => {
  const entry = (ceClose: number, peClose: number): StrikeHistoryEntry => ({ ceOi: 1000, peOi: 2000, ceClose, peClose, ceVolume: 10, peVolume: 20 });
  const dateMap = new Map([
    ['2026-10-22', new Map([['2026-10-27', entry(101, 202)]])],
    ['2026-10-23', new Map([['2026-10-27', entry(111, 222)]])],
  ]);
  const props = { dates: ['2026-10-22', '2026-10-23'], dateMap, maxOi: 2000, expiries: ['2026-10-27'], expiryColors: new Map([['2026-10-27', '#6366f1']]), showVolume: false };

  it('plots CE prices for the CE chart and PE prices for the PE chart', () => {
    // Drop React's text separators so "₹{price}" reads as one string.
    const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<!-- -->/g, '');
    const ce = render(<StrikeOiChart optionType="CE" maxPrice={111} {...props} />);
    const pe = render(<StrikeOiChart optionType="PE" maxPrice={222} {...props} />);

    expect(ce).toContain('>CE</div>');
    expect(ce).toContain('₹101');
    expect(ce).not.toContain('₹202');
    expect(ce).not.toContain('oi-history__chart-label--pe');
    expect(pe).toContain('oi-history__chart-label--pe');
    expect(pe).toContain('₹222');
    expect(pe).not.toContain('₹101');
  });

  it('renders nothing without OI', () => {
    expect(renderToStaticMarkup(<StrikeOiChart optionType="CE" maxPrice={111} {...props} maxOi={0} />)).toBe('');
  });
});

describe('SignalResultsGrid', () => {
  const signal = (overrides: Partial<TradeSignalRow>): TradeSignalRow => ({
    id: 1,
    signal_date: '2026-10-14',
    expiry: '2026-10-19',
    strike: 22700,
    option_type: 'CE',
    action: 'SELL',
    entry_premium: 122.3,
    outcome_price: null,
    outcome_date: null,
    outcome_status: null,
    outcome_return: null,
    max_favorable_return: null,
    max_adverse_return: null,
    outcome_final: false,
    ...overrides,
  });

  it('lists each signal with its outcome and tints profit and loss rows', () => {
    const html = renderToStaticMarkup(
      <SignalResultsGrid
        rows={[
          signal({ id: 1, outcome_price: 55.6, outcome_status: 'Profit', outcome_return: 54.53, max_favorable_return: 60, max_adverse_return: -5, outcome_final: true }),
          signal({ id: 2, action: 'BUY', option_type: 'PE', strike: 22500, outcome_price: 60, outcome_status: 'Loss', outcome_return: -12.5 }),
          signal({ id: 3 }),
        ]}
      />,
    ).replace(/<!-- -->/g, '');

    expect(html.match(/<tr class="is-profit">/g)).toHaveLength(1);
    expect(html.match(/<tr class="is-loss">/g)).toHaveLength(1);
    expect(html).toContain('SELL CE 22700');
    expect(html).toContain('BUY PE 22500');
    expect(html).toContain('Oct 14');
    expect(html).toContain('122.30');
    expect(html).toContain('+54.5%');
    expect(html).toContain('-12.5%');
    // Final profit has no live marker; the unsettled loss does; the unscored signal is Open.
    expect(html).toContain('<td>Profit</td>');
    expect(html).toContain('Loss<small> · live</small>');
    expect(html).toContain('<td>Open</td>');
  });
});
