import React from 'react';
import { InfoGuide, GuideGrid, GuideSection, GuideRows, GuideTerms, GuideNote, GuideFooter, type GuideRow, type GuideTerm } from '@/components/InfoGuide/InfoGuide';

const OI_PRICE: GuideRow[] = [
  { label: 'Long Buildup', tone: 'bull', rule: 'OI ↑ · Price ↑', meaning: 'New buyers entering. Bullish for the option.' },
  { label: 'Short Buildup', tone: 'bear', rule: 'OI ↑ · Price ↓', meaning: 'New sellers entering. Bearish for the option.' },
  { label: 'Long Unwinding', tone: 'bear', rule: 'OI ↓ · Price ↓', meaning: 'Buyers exiting, giving up.' },
  { label: 'Short Covering', tone: 'bull', rule: 'OI ↓ · Price ↑', meaning: 'Sellers exiting, bears retreating.' },
];

export const IV_FLOW_ROWS: GuideRow[] = [
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

const HOVER_MEASURES: GuideTerm[] = [
  { term: 'IV', meaning: 'Implied volatility, its change, and the change against ATM' },
  { term: 'Delta-weighted OI', meaning: '50K at ATM outweighs 50K far OTM' },
  { term: 'Unusual', meaning: 'OI change vs this strike’s usual daily change' },
  { term: 'Share of volume', meaning: 'Low means intraday churn, not new positions' },
  { term: 'Recent OI', meaning: 'Share of OI added in the last 3 sessions' },
];

const EXAMPLES: GuideTerm[] = [
  { term: 'CE Short Buildup @ 1800', meaning: 'Call sellers adding, expecting price to stay below 1800. Resistance forming.' },
  { term: 'PE Long Buildup @ 1700', meaning: 'Put buyers entering, expecting a fall below 1700. Bearish bet.' },
  { term: 'PE Short Covering @ 1700', meaning: 'Put sellers exiting. Support at 1700 weakening.' },
  { term: 'CE Long Unwinding @ 1800', meaning: 'Call buyers giving up on the 1800 breakout.' },
];

/** Explains the OI Snapshot pattern labels, IV flow and hover measures. */
export const PatternGuide: React.FC = () => (
  <InfoGuide
    title="Reading the patterns"
    intro="Each strike shows who looks active, from the day-over-day OI change. The first line uses option price; the second line (IV) is for the nearest expiry and corrects for spot, time decay and chain-wide IV moves."
  >
    <GuideGrid>
      <GuideSection title="OI + Price" subtitle="Single expiry · first line">
        <GuideRows rows={OI_PRICE} />
      </GuideSection>
      <GuideSection title="IV Flow" subtitle="Nearest expiry · second line">
        <GuideRows rows={IV_FLOW_ROWS} />
      </GuideSection>
      <GuideSection title="Rollover" subtitle="Several expiries visible · first line" wide>
        <GuideRows rows={ROLLOVER} twoCol />
      </GuideSection>
      <GuideSection title="Hover a CE / PE cell" subtitle="Freshness of the OI">
        <GuideTerms terms={HOVER_MEASURES} />
      </GuideSection>
      <GuideSection title="Examples" subtitle="How to read a label">
        <GuideTerms terms={EXAMPLES} />
      </GuideSection>
    </GuideGrid>
    <GuideNote>
      OI never shows <strong>why</strong> a position exists: covered calls, spread legs, hedges and arbitrage look the same. Treat labels as hints, not verdicts.
    </GuideNote>
    <GuideFooter>Dimmed rows have OI below 5% of the max. Click a row to chart its OI and price across dates.</GuideFooter>
  </InfoGuide>
);
