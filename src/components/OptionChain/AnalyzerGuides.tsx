import React from 'react';
import { InfoGuide, GuideGrid, GuideSection, GuideRows, GuideTerms, GuideNote, type GuideRow, type GuideTerm } from '@/components/InfoGuide/InfoGuide';
import { IV_FLOW_ROWS } from '@/components/OiHistory/PatternGuide';
import { OiFlow, oiFlowLabel } from '../../../shared/analysisEnums.js';
import { GuideTone } from '@/utils/uiEnums';

const OI_PRICE_ROWS: GuideRow[] = [
  { label: 'Long Buildup', tone: GuideTone.Bull, rule: 'OI ↑ · Price ↑', meaning: 'New buyers entering (bullish for the option).' },
  { label: 'Short Buildup', tone: GuideTone.Bear, rule: 'OI ↑ · Price ↓', meaning: 'New sellers entering (bearish for the option).' },
  { label: 'Long Unwinding', tone: GuideTone.Bear, rule: 'OI ↓ · Price ↓', meaning: 'Buyers exiting, giving up.' },
  { label: 'Short Covering', tone: GuideTone.Bull, rule: 'OI ↓ · Price ↑', meaning: 'Sellers exiting, bears retreating.' },
];

/** Live IV flow uses the flat 2% OI rule: there is no daily history on this screen. */
const LIVE_IV_FLOW_ROWS: GuideRow[] = IV_FLOW_ROWS.map((row) =>
  row.label === oiFlowLabel(OiFlow.Stable) ? { ...row, meaning: 'OI change under 2% since yesterday’s close.' } : row,
);

const PRICE_CAVEAT = (
  <GuideNote>
    An option premium also moves with spot, time decay and chain-wide IV, so <strong>OI + Price</strong> can mislabel who is active.
    It still drives the scores here; <strong>IV Flow</strong> is shown alongside for comparison and is not scored yet.
  </GuideNote>
);

const SCORE_SCALE: GuideRow[] = [
  { label: '0–30', tone: GuideTone.Bear, meaning: 'Weak' },
  { label: '30–60', tone: GuideTone.Warn, meaning: 'Moderate' },
  { label: '60–80', tone: GuideTone.Bull, meaning: 'Strong' },
  { label: '80–100', tone: GuideTone.Bull, meaning: 'Very strong' },
];

/** ⓘ panel for the OI bar chart. */
export const OiChartGuide: React.FC = () => {
  const bars: GuideTerm[] = [
    { term: 'Green bars (left)', meaning: 'CE (call) open interest' },
    { term: 'Red bars (right)', meaning: 'PE (put) open interest' },
    { term: 'Cross-hatched top', meaning: 'OI added since yesterday’s close' },
    { term: 'Dashed marker', meaning: 'OI was higher yesterday: positions unwound' },
    { term: 'Glowing border', meaning: 'Volume-confirmed: OI moved and volume backs it' },
    { term: 'Velocity ▲ / ▼', meaning: 'OI moved 5%+ in 10 minutes (build / unwind)' },
    { term: 'Shaded zone', meaning: 'Expected range from the ATM straddle; walls outside it are stronger' },
  ];
  const heatmap: GuideRow[] = [
    { label: 'Bullish', tone: GuideTone.Bull, meaning: 'CE buyers + PE sellers' },
    { label: 'Bearish', tone: GuideTone.Bear, meaning: 'CE sellers + PE buyers' },
    { label: 'Pinning / Range', tone: GuideTone.Warn, meaning: 'Sellers on both sides' },
    { label: 'Volatility / Breakout', tone: GuideTone.Violet, meaning: 'Buyers on both sides, or sellers exiting' },
    { label: 'Mixed', tone: GuideTone.Muted, meaning: 'De-risking or conflicting signals' },
  ];
  const tooltip: GuideTerm[] = [
    { term: 'Header', meaning: 'Strike, ATM tag and the strike’s put/call ratio (PCR)' },
    { term: 'OI · Chg', meaning: 'Open interest and its change vs yesterday’s close' },
    { term: 'IV flow', meaning: 'Who is active by IV vs ATM; hover it for IV, delta-weighted OI and share of volume' },
    { term: 'Velocity', meaning: 'OI change over the last snapshot interval (% / minutes)' },
    { term: 'Sparkline', meaning: 'OI curve since market open with its trend' },
    { term: 'Signal · Volume', meaning: 'Combined heatmap stance and whether volume confirms it' },
    { term: 'Sell PE / Sell CE', meaning: 'Paper position at the current LTP' },
  ];
  const trends: GuideRow[] = [
    { label: 'Accelerating Buildup', tone: GuideTone.Bull, meaning: 'OI growing and speeding up' },
    { label: 'Steady Buildup', tone: GuideTone.Bull, meaning: 'OI growing at a steady pace' },
    { label: 'Slowing Buildup', tone: GuideTone.Bull, meaning: 'Still growing, momentum fading' },
    { label: 'Accelerating Unwind', tone: GuideTone.Bear, meaning: 'OI falling and speeding up' },
    { label: 'Steady Unwind', tone: GuideTone.Bear, meaning: 'OI falling at a steady pace' },
    { label: 'Slowing Unwind', tone: GuideTone.Bear, meaning: 'Falling, momentum fading (possible reversal)' },
    { label: 'Volatile', tone: GuideTone.Muted, meaning: 'OI alternating with no clear trend' },
    { label: 'Stable', tone: GuideTone.Muted, meaning: 'OI barely moved all day' },
  ];
  const takeaways: GuideTerm[] = [
    { term: 'Tallest CE bar', meaning: 'Strongest resistance: call writers defending it' },
    { term: 'Tallest PE bar', meaning: 'Strongest support: put writers defending it' },
    { term: 'Glow + velocity ▲', meaning: 'A wall being built right now' },
    { term: 'Slowing Unwind', meaning: 'Writers stopped exiting: the wall may hold' },
  ];

  return (
    <InfoGuide
      title="Reading the OI chart"
      intro="Each strike has a CE bar and a PE bar. Taller bars mean more open contracts. Click a strike for its details."
    >
      <GuideGrid>
        <GuideSection title="Bars and markers" subtitle="What you see on the chart">
          <GuideTerms terms={bars} />
        </GuideSection>
        <GuideSection title="Signal heatmap" subtitle="Strip below the bars · OI + Price">
          <GuideRows rows={heatmap} />
          <p>Combines CE and PE OI + Price from 10-minute snapshots. Appears after the first snapshot; moves under 2% OI or 0.5% price are ignored.</p>
        </GuideSection>
        <GuideSection title="Tooltip" subtitle="Click a strike">
          <GuideTerms terms={tooltip} />
        </GuideSection>
        <GuideSection title="IV flow" subtitle="In the tooltip, per side">
          <GuideRows rows={LIVE_IV_FLOW_ROWS} />
        </GuideSection>
        <GuideSection title="Velocity trend" subtitle="Sparkline in the tooltip" wide>
          <GuideRows rows={trends} twoCol />
        </GuideSection>
        <GuideSection title="Key takeaways" subtitle="Reading walls" wide>
          <GuideTerms terms={takeaways} />
        </GuideSection>
      </GuideGrid>
    </InfoGuide>
  );
};

/** ⓘ panel for the Sell strategy. */
export const SellStrategyGuide: React.FC = () => (
  <InfoGuide
    title="How Sell Strategy works"
    intro="Scores each OTM strike on five factors to find option-selling setups. Needs 20+ minutes of OI snapshots."
  >
    <GuideGrid>
      <GuideSection title="Scoring factors" subtitle="Total 0–100" wide>
        <GuideRows rows={[
          { label: 'Pinning', tone: GuideTone.Plain, rule: '0–25', meaning: 'Spot near max pain with balanced PCR: sellers defend both sides.' },
          { label: 'OI Wall', tone: GuideTone.Plain, rule: '0–25', meaning: 'Heavy OI wall at the strike with fresh short buildup (OI + Price). Volume-backed walls score higher.' },
          { label: 'Velocity', tone: GuideTone.Plain, rule: '0–20', meaning: 'OI building through the day. Volume-confirmed buildup scores higher.' },
          { label: 'PCR Extreme', tone: GuideTone.Plain, rule: '0–15', meaning: 'Sustained extreme PCR on the sell side: low for calls, high for puts.' },
          { label: 'Theta Decay', tone: GuideTone.Plain, rule: '0–15', meaning: 'Closer to expiry, more decay working for sellers.' },
        ]} />
      </GuideSection>
      <GuideSection title="Recommendations" subtitle="What gets suggested">
        <GuideTerms terms={[
          { term: 'Sell CE', meaning: 'OTM call above spot' },
          { term: 'Sell PE', meaning: 'OTM put below spot' },
          { term: 'Straddle', meaning: 'CE + PE at one near-ATM strike (pinning)' },
          { term: 'Strangle', meaning: 'OTM CE + OTM PE at different strikes' },
        ]} />
      </GuideSection>
      <GuideSection title="Score scale" subtitle="Badge colour">
        <GuideRows rows={SCORE_SCALE} />
      </GuideSection>
    </GuideGrid>
    {PRICE_CAVEAT}
  </InfoGuide>
);

/** ⓘ panel for the Buy strategy. */
export const BuyStrategyGuide: React.FC = () => (
  <InfoGuide
    title="How Buy Strategy works"
    intro="Scores ATM and slightly OTM strikes on five factors to find directional buying setups. Needs 20+ minutes of OI snapshots."
  >
    <GuideGrid>
      <GuideSection title="Scoring factors" subtitle="Total 0–100" wide>
        <GuideRows rows={[
          { label: 'Breakout', tone: GuideTone.Plain, rule: '0–25', meaning: 'OI walls weakening. Breakouts on surging volume score higher; thin volume may be fake.' },
          { label: 'Directional OI', tone: GuideTone.Plain, rule: '0–25', meaning: 'Sustained Long Buildup (OI + Price) across nearby strikes.' },
          { label: 'Momentum', tone: GuideTone.Plain, rule: '0–20', meaning: 'Velocity accelerating on the buy side while the other side unwinds.' },
          { label: 'PCR Shift', tone: GuideTone.Plain, rule: '0–15', meaning: 'PCR trending your way: rising for CE, falling for PE.' },
          { label: 'Risk / Reward', tone: GuideTone.Plain, rule: '0–15', meaning: 'Distance vs expected move and premium. Near ATM with a low breakeven is best.' },
        ]} />
      </GuideSection>
      <GuideSection title="Recommendations" subtitle="What gets suggested">
        <GuideTerms terms={[
          { term: 'Buy CE', meaning: 'Near-ATM call for a bullish move' },
          { term: 'Buy PE', meaning: 'Near-ATM put for a bearish move' },
          { term: 'Straddle', meaning: 'CE + PE at ATM (volatility expansion)' },
          { term: 'Strangle', meaning: 'OTM CE + OTM PE (cheaper volatility play)' },
        ]} />
      </GuideSection>
      <GuideSection title="Score scale" subtitle="Badge colour">
        <GuideRows rows={SCORE_SCALE} />
      </GuideSection>
    </GuideGrid>
    {PRICE_CAVEAT}
  </InfoGuide>
);

/** ⓘ panel for the trap (position) analyzer. */
export const PositionAnalyzerGuide: React.FC = () => (
  <InfoGuide
    title="How Position Analyzer works"
    intro="Combines max pain, OI activity, PCR, OI walls and time to expiry into a trap score for a position at the chosen strike."
  >
    <GuideGrid>
      <GuideSection title="OI Signal" subtitle="OI + Price · scored">
        <GuideRows rows={OI_PRICE_ROWS} />
      </GuideSection>
      <GuideSection title="IV Flow" subtitle="Shown below OI Signal · not scored">
        <GuideRows rows={LIVE_IV_FLOW_ROWS} />
      </GuideSection>
      <GuideSection title="Max pain and PCR" subtitle="Where the chain leans">
        <GuideTerms terms={[
          { term: 'Max pain', meaning: 'Strike where most options expire worthless. Price tends to drift toward it near expiry.' },
          { term: 'PCR > 1.5', meaning: 'Heavy put writing: a fall is less likely (bullish lean)' },
          { term: 'PCR < 0.7', meaning: 'Heavy call writing: a rise is less likely (bearish lean)' },
          { term: 'PCR ≈ 1.0', meaning: 'Balanced, no strong lean' },
        ]} />
      </GuideSection>
      <GuideSection title="OI walls" subtitle="Levels writers defend">
        <GuideTerms terms={[
          { term: 'High CE OI', meaning: 'Resistance: call writers defend against a rise through it' },
          { term: 'High PE OI', meaning: 'Support: put writers defend against a fall through it' },
        ]} />
      </GuideSection>
      <GuideSection title="Trap score" subtitle="Points against your position (max 9)">
        <GuideRows rows={[
          { label: 'Max Pain', tone: GuideTone.Plain, rule: '+2', meaning: 'Strike on the wrong side of max pain' },
          { label: 'OI Wall', tone: GuideTone.Plain, rule: '+2', meaning: 'Heavy wall blocking your direction' },
          { label: 'OI Signal', tone: GuideTone.Plain, rule: '+2', meaning: 'Activity against your position' },
          { label: 'PCR', tone: GuideTone.Plain, rule: '+1', meaning: 'PCR skewed against you' },
          { label: 'Time', tone: GuideTone.Plain, rule: '+1 / +2', meaning: 'Within 3 days of expiry / expiry day' },
        ]} />
      </GuideSection>
      <GuideSection title="Verdict" subtitle="From the trap score">
        <GuideRows rows={[
          { label: 'Safe', tone: GuideTone.Bull, rule: '0–1', meaning: 'Nothing significant against you' },
          { label: 'Caution', tone: GuideTone.Warn, rule: '2–3', meaning: 'Some risk, not conclusive' },
          { label: 'Likely Trapped', tone: GuideTone.Bear, rule: '4+', meaning: 'Several strong signals against you' },
        ]} />
      </GuideSection>
    </GuideGrid>
    {PRICE_CAVEAT}
  </InfoGuide>
);
