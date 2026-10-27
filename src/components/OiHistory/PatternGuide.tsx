import React from 'react';

type Tone = 'bull' | 'bear' | 'accent' | 'muted';

interface GuideRow {
  label: string;
  tone: Tone;
  rule?: string;
  meaning: string;
}

const OI_PRICE: GuideRow[] = [
  { label: 'Long Buildup', tone: 'bull', rule: 'OI ↑ · Price ↑', meaning: 'New buyers entering. Bullish for the option.' },
  { label: 'Short Buildup', tone: 'bear', rule: 'OI ↑ · Price ↓', meaning: 'New sellers entering. Bearish for the option.' },
  { label: 'Long Unwinding', tone: 'bear', rule: 'OI ↓ · Price ↓', meaning: 'Buyers exiting, giving up.' },
  { label: 'Short Covering', tone: 'bull', rule: 'OI ↓ · Price ↑', meaning: 'Sellers exiting, bears retreating.' },
];

const IV_FLOW: GuideRow[] = [
  { label: 'Buyers Adding', tone: 'bull', rule: 'OI ↑ · IV ↑ vs ATM', meaning: 'Buyers are paying up for this strike.' },
  { label: 'Writers Adding', tone: 'bear', rule: 'OI ↑ · IV ↓ vs ATM', meaning: 'Writers are pressing premiums down.' },
  { label: 'Buyers Exiting', tone: 'bear', rule: 'OI ↓ · IV ↓ vs ATM', meaning: 'Longs closing out.' },
  { label: 'Writers Covering', tone: 'bull', rule: 'OI ↓ · IV ↑ vs ATM', meaning: 'Shorts buying back.' },
  { label: 'Unclear', tone: 'muted', rule: 'OI moved · IV flat', meaning: 'IV within 0.5 pts of ATM, so no side stands out.' },
  { label: 'Stable', tone: 'muted', rule: 'OI normal', meaning: 'Under 1.5× the strike’s usual daily change (2% without history).' },
];

const ROLLOVER: GuideRow[] = [
  { label: 'Rolling Over (Short)', tone: 'accent', meaning: 'Writers moving to the next expiry. Strike is being defended.' },
  { label: 'Rolling Over (Long)', tone: 'accent', meaning: 'Buyers moving to the next expiry. Conviction maintained.' },
  { label: 'Fresh Build (Short)', tone: 'bull', meaning: 'New sellers at a far expiry. A new wall forming.' },
  { label: 'Fresh Build (Long)', tone: 'bull', meaning: 'New buyers at a far expiry. A new directional bet.' },
  { label: 'Doubling Down (Long)', tone: 'bull', meaning: 'OI rising across expiries with premium rising.' },
  { label: 'Doubling Down (Short)', tone: 'bear', meaning: 'OI rising across expiries with premium falling.' },
  { label: 'Exiting (Long Unwind)', tone: 'bear', meaning: 'Buyers closing out, nothing replacing them.' },
  { label: 'Exiting (Short Cover)', tone: 'bear', meaning: 'Sellers closing out. The wall is being abandoned.' },
  { label: 'Unwinding', tone: 'bear', meaning: 'OI falling across all expiries.' },
  { label: 'Stable', tone: 'muted', meaning: 'No significant change (under 2%).' },
];

const HOVER_MEASURES: { name: string; meaning: string }[] = [
  { name: 'IV', meaning: 'Implied volatility, its change, and the change against ATM' },
  { name: 'Delta-weighted OI', meaning: '50K at ATM outweighs 50K far OTM' },
  { name: 'Unusual', meaning: 'OI change vs this strike’s usual daily change' },
  { name: 'Share of volume', meaning: 'Low means intraday churn, not new positions' },
  { name: 'Recent OI', meaning: 'Share of OI added in the last 3 sessions' },
];

const EXAMPLES: { tag: string; text: string }[] = [
  { tag: 'CE Short Buildup @ 1800', text: 'Call sellers adding, expecting price to stay below 1800. Resistance forming.' },
  { tag: 'PE Long Buildup @ 1700', text: 'Put buyers entering, expecting a fall below 1700. Bearish bet.' },
  { tag: 'PE Short Covering @ 1700', text: 'Put sellers exiting. Support at 1700 weakening.' },
  { tag: 'CE Long Unwinding @ 1800', text: 'Call buyers giving up on the 1800 breakout.' },
];

const Rows: React.FC<{ rows: GuideRow[]; compact?: boolean }> = ({ rows, compact }) => (
  <ul className={`oi-guide__rows ${compact ? 'oi-guide__rows--compact' : ''}`}>
    {rows.map((row) => (
      <li key={row.label} className="oi-guide__row">
        <span className={`oi-guide__chip oi-guide__chip--${row.tone}`}>{row.label}</span>
        {row.rule && <span className="oi-guide__rule">{row.rule}</span>}
        <span className="oi-guide__meaning">{row.meaning}</span>
      </li>
    ))}
  </ul>
);

/** Explains the OI Snapshot pattern labels, IV flow and hover measures. */
export const PatternGuide: React.FC = () => (
  <div className="oi-guide">
    <div className="oi-guide__intro">
      <h4 className="oi-guide__title">Reading the patterns</h4>
      <p>Each strike shows who looks active, from the day-over-day OI change. The first line uses option price; the second line (IV) is for the nearest expiry and corrects for spot, time decay and chain-wide IV moves.</p>
    </div>

    <div className="oi-guide__grid">
      <section className="oi-guide__section">
        <header>
          <h5>OI + Price</h5>
          <span>Single expiry · first line</span>
        </header>
        <Rows rows={OI_PRICE} />
      </section>

      <section className="oi-guide__section">
        <header>
          <h5>IV Flow</h5>
          <span>Nearest expiry · second line</span>
        </header>
        <Rows rows={IV_FLOW} />
      </section>

      <section className="oi-guide__section oi-guide__section--wide">
        <header>
          <h5>Rollover</h5>
          <span>Several expiries visible · first line</span>
        </header>
        <Rows rows={ROLLOVER} compact />
      </section>

      <section className="oi-guide__section">
        <header>
          <h5>Hover a CE / PE cell</h5>
          <span>Freshness of the OI</span>
        </header>
        <dl className="oi-guide__measures">
          {HOVER_MEASURES.map((m) => (
            <React.Fragment key={m.name}>
              <dt>{m.name}</dt>
              <dd>{m.meaning}</dd>
            </React.Fragment>
          ))}
        </dl>
      </section>

      <section className="oi-guide__section">
        <header>
          <h5>Examples</h5>
          <span>How to read a label</span>
        </header>
        <ul className="oi-guide__examples">
          {EXAMPLES.map((e) => (
            <li key={e.tag}>
              <span className="oi-guide__example-tag">{e.tag}</span>
              <span className="oi-guide__meaning">{e.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>

    <p className="oi-guide__note">
      OI never shows <strong>why</strong> a position exists: covered calls, spread legs, hedges and arbitrage look the same. Treat labels as hints, not verdicts.
    </p>
    <p className="oi-guide__footer">Dimmed rows have OI below 5% of the max. Click a row to chart its OI and price across dates.</p>
  </div>
);
