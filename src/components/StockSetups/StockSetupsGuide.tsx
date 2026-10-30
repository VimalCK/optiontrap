import React from 'react';
import { InfoGuide, GuideGrid, GuideSection, GuideRows, GuideTerms, type GuideRow, type GuideTerm } from '@/components/InfoGuide/InfoGuide';

const STATES: GuideRow[] = [
  { label: 'Falling', tone: 'bear', rule: 'New 20d low · or < 50d avg', meaning: 'Still going down. Don’t catch it: wait for it to stop.' },
  { label: 'Stretched', tone: 'warn', rule: 'New low · 2+ ATR under 20d avg · or RSI < 30', meaning: 'Fell too far too fast. A bounce is likely, but the fall can resume.' },
  { label: 'Turning', tone: 'accent', rule: 'Was falling · no new low · close > prev high', meaning: 'First sign the fall is pausing.' },
  { label: 'Uptrend', tone: 'bull', rule: '> 50d avg · 20d avg > 50d avg', meaning: 'Healthy trend. Buy the dips to support.' },
  { label: 'Sideways', tone: 'muted', rule: 'None of the above', meaning: 'No clear direction.' },
];

const SETUPS: GuideRow[] = [
  { label: 'Pullback', tone: 'bull', rule: '> 200d avg · dip into support · close in upper half', meaning: 'Buy: buyers defended support in an uptrend.' },
  { label: 'Reversal', tone: 'bull', rule: 'Turning · recent low at support', meaning: 'Buy: a falling stock found a floor.' },
  { label: 'Breakout', tone: 'bull', rule: 'Close above a zone · volume ≥ 1.5× avg', meaning: 'Buy: the ceiling gave way.' },
  { label: 'Rejection', tone: 'bear', rule: '< 50d avg · into resistance · red candle', meaning: 'Exit: sellers pushed it back.' },
  { label: 'Breakdown', tone: 'bear', rule: 'Close below a zone · volume ≥ 1.5× avg', meaning: 'Exit: the floor gave way.' },
];

const MARKET: GuideRow[] = [
  { label: 'Falling on its own', tone: 'bear', rule: 'Stock ≤ −3% · 3%+ worse than NIFTY', meaning: 'Company-specific selling. Riskiest to buy.' },
  { label: 'Falling with market', tone: 'warn', rule: 'Stock down · NIFTY ≤ −3%', meaning: 'Usually recovers when the market does.' },
  { label: 'Stronger than market', tone: 'bull', rule: '3%+ better than NIFTY', meaning: 'Relative strength: buyers favour it.' },
  { label: 'In line', tone: 'muted', rule: 'Otherwise', meaning: 'Moving with NIFTY.' },
];

const STRENGTH: GuideRow[] = [
  { label: 'High-volume area', tone: 'violet', rule: '1.5 pts (top 3) · 1 pt', meaning: 'Where far more shares traded than usual in the last ~6 months. Holders defend their buy price.' },
  { label: 'Swing low / high', tone: 'accent', rule: '1 pt (last 3 mo) · 0.7 pt', meaning: 'A day whose low (high) beat the 3 days on each side: a point where the price turned.' },
  { label: '200-day average', tone: 'plain', rule: '1 pt', meaning: 'Long-term trend line (~10 months).' },
  { label: '50-day average', tone: 'plain', rule: '0.75 pt', meaning: 'Medium-term trend line (~2½ months).' },
  { label: 'Round number', tone: 'muted', rule: '0.5 pt', meaning: '₹300, ₹350, ₹700… where orders cluster. Never a zone on its own.' },
];

const HISTORY: GuideTerm[] = [
  { term: 'A test', meaning: 'The price reaches the zone after staying away for at least 5 days. Back-to-back days in the zone are one test' },
  { term: 'Held', meaning: 'Support: bounced 3% or more (2× ATR for volatile stocks) before closing clearly below. Resistance shows “Rejected” for the same drop' },
  { term: 'Broke', meaning: 'Closed through the zone by about 2% (1× ATR for volatile stocks)' },
  { term: 'Neither', meaning: 'Nothing decisive within 20 sessions, so it counts as a test only' },
  { term: 'Avg move', meaning: 'Average bounce (or drop) after the tests' },
  { term: 'Held 5 of 6', meaning: '6 tests, 5 bounces: buyers defend it reliably. “Held 1 of 5” means it usually gives way' },
];

const SWINGS: GuideTerm[] = [
  { term: 'swing low ×6', meaning: 'The price turned up from this zone 6 times in the last year' },
  { term: 'swing high ×14', meaning: 'The price turned down here 14 times in the last year: a ceiling sellers defended' },
  { term: 'Swing high in a support', meaning: 'An old ceiling the stock rose through. Old ceilings often become new floors (and old floors new ceilings)' },
  { term: '×N', meaning: 'The reason occurred N times in the zone. The first counts fully, the next two at half, later ones add nothing, so ×14 is not 14× stronger' },
];

const TRADE: GuideTerm[] = [
  { term: 'Entry', meaning: 'The signal day’s close' },
  { term: 'Stop', meaning: 'Just beyond the zone. The idea is wrong once the price reaches it' },
  { term: 'Target', meaning: 'The next zone in the trade’s direction, or 2× the risk when there is none' },
  { term: 'R:R', meaning: '(Target − Entry) ÷ (Entry − Stop). Entry ₹100, stop ₹98, target ₹106 → 6 ÷ 2 = 3.0. Below 1.0 is never shown' },
  { term: 'Tracking', meaning: 'Each setup is followed for 20 sessions until it touches the target or the stop. If one day touches both, it counts as stopped' },
];

const INDICATORS: GuideTerm[] = [
  { term: 'ATR (14)', meaning: 'Average True Range: the stock’s normal daily move in rupees. ₹14.70 on ₹685 ≈ 2% a day. Sets zone width and stop distance' },
  { term: 'RSI (14)', meaning: 'Momentum 0–100. Under 30 oversold, over 70 overbought, ~50 neutral' },
  { term: '20 / 50 / 200d avg', meaning: 'Average close: short, medium and long-term trend. Price above = trend up' },
];

/** Explains the entry & exit zone rules: states, setups, zone scoring and history. */
const StockSetupsGuide: React.FC = () => (
  <InfoGuide>
    <GuideGrid>
      <GuideSection title="State" wide>
        <GuideRows rows={STATES} />
      </GuideSection>
      <GuideSection title="Setups" wide>
        <GuideRows rows={SETUPS} />
      </GuideSection>
      <GuideSection title="What makes a zone" wide>
        <GuideRows rows={STRENGTH} />
      </GuideSection>
      <GuideSection title="Swings" wide>
        <GuideTerms terms={SWINGS} />
      </GuideSection>
      <GuideSection title="Zone history" wide>
        <GuideTerms terms={HISTORY} />
      </GuideSection>
      <GuideSection title="Stock vs NIFTY 50" wide>
        <GuideRows rows={MARKET} />
      </GuideSection>
      <GuideSection title="Trade levels" wide>
        <GuideTerms terms={TRADE} />
      </GuideSection>
      <GuideSection title="Indicators" wide>
        <GuideTerms terms={INDICATORS} />
      </GuideSection>
    </GuideGrid>
  </InfoGuide>
);

export default StockSetupsGuide;
