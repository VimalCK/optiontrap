/**
 * Combined OI Signal Service
 * Classifies CE + PE OI+Price signals per strike and combines them
 * into a single market stance for the OI chart signal strip.
 */

import { classifyOiSignal } from './trapAnalysis';
import { CombinedStance, Confidence, OiSignal, type CombinedStanceId, type ConfidenceId, type OiSignalId } from '../../shared/analysisEnums.js';
import { OiSnapshot } from './oiSnapshots';
import { OptionChainRow } from './optionChain';

/** A strike's stance, or null when neither leg moved enough. */
export type StrikeStance = CombinedStanceId | null;

/** How much volume backs a strike's signal, or null without volume data. */
export type VolumeConfidence = ConfidenceId | null;

export interface StrikeSignal {
  stance: StrikeStance;
  ceSignal: OiSignalId;
  peSignal: OiSignalId;
  label: string;
  color: string;
  weak: boolean;  // true for single-leg (0.5 opacity) stances
  confidence: VolumeConfidence;  // volume-based confidence level
}

const OI_THRESHOLD = 2;      // % minimum OI change to count as signal
const PRICE_THRESHOLD = 0.5; // % minimum price change to count as signal

interface StanceConfig {
  stance: StrikeStance;
  label: string;
  color: string;
  weak: boolean;
}

function combineSignals(ceSignal: OiSignalId, peSignal: OiSignalId): StanceConfig {
  const key = `${ceSignal}|${peSignal}`;

  // Both-leg combinations (strong signals)
  const bothLeg: Record<string, StanceConfig> = {
    [`${OiSignal.ShortBuildup}|${OiSignal.ShortBuildup}`]:   { stance: CombinedStance.Pinning,        label: 'Pinning/Range',    color: '#f59e0b', weak: false },
    [`${OiSignal.LongBuildup}|${OiSignal.ShortBuildup}`]:    { stance: CombinedStance.Bullish,        label: 'Bullish',          color: '#4ade80', weak: false },
    [`${OiSignal.ShortBuildup}|${OiSignal.LongBuildup}`]:    { stance: CombinedStance.Bearish,        label: 'Bearish',          color: '#f87171', weak: false },
    [`${OiSignal.LongBuildup}|${OiSignal.LongBuildup}`]:     { stance: CombinedStance.HighVolatility, label: 'High Volatility',  color: '#a78bfa', weak: false },
    [`${OiSignal.ShortCovering}|${OiSignal.ShortCovering}`]: { stance: CombinedStance.Breakout,       label: 'Breakout Setup',   color: '#a78bfa', weak: false },
    [`${OiSignal.LongUnwinding}|${OiSignal.LongUnwinding}`]: { stance: CombinedStance.DeRisking,      label: 'De-risking',       color: '#94a3b8', weak: false },
    [`${OiSignal.LongBuildup}|${OiSignal.ShortCovering}`]:   { stance: CombinedStance.StrongBullish,  label: 'Strong Bullish',   color: '#22c55e', weak: false },
    [`${OiSignal.ShortCovering}|${OiSignal.LongBuildup}`]:   { stance: CombinedStance.StrongBearish,  label: 'Strong Bearish',   color: '#ef4444', weak: false },
  };

  if (bothLeg[key]) return bothLeg[key];

  if (peSignal === OiSignal.Neutral) {
    switch (ceSignal) {
      case OiSignal.LongBuildup:   return { stance: CombinedStance.BullishWeak, label: 'Bullish (weak)',  color: '#4ade80', weak: true };
      case OiSignal.ShortBuildup:  return { stance: CombinedStance.BearishWeak, label: 'Bearish (weak)',  color: '#f87171', weak: true };
      case OiSignal.LongUnwinding: return { stance: CombinedStance.FadingBull,  label: 'Fading Bull',     color: '#94a3b8', weak: true };
      case OiSignal.ShortCovering: return { stance: CombinedStance.FadingBear,  label: 'Fading Bear',     color: '#94a3b8', weak: true };
    }
  }

  if (ceSignal === OiSignal.Neutral) {
    switch (peSignal) {
      case OiSignal.LongBuildup:   return { stance: CombinedStance.BearishWeak, label: 'Bearish (weak)',  color: '#f87171', weak: true };
      case OiSignal.ShortBuildup:  return { stance: CombinedStance.BullishWeak, label: 'Bullish (weak)',  color: '#4ade80', weak: true };
      case OiSignal.LongUnwinding: return { stance: CombinedStance.FadingBear,  label: 'Fading Bear',     color: '#94a3b8', weak: true };
      case OiSignal.ShortCovering: return { stance: CombinedStance.FadingBull,  label: 'Fading Bull',     color: '#94a3b8', weak: true };
    }
  }

  if (ceSignal === OiSignal.Neutral && peSignal === OiSignal.Neutral) {
    return { stance: null, label: '', color: 'transparent', weak: false };
  }

  // Mixed / transitional (all other combinations)
  return { stance: CombinedStance.Transitional, label: 'Transitional', color: '#64748b', weak: false };
}

/**
 * Classify a single instrument's OI+Price change vs the last snapshot.
 * Returns OiSignal.Neutral if below thresholds.
 */
function classifyInstrument(
  _token: number,
  currentOi: number,
  currentPrice: number,
  snapshotOi: number,
  snapshotPrice: number,
): OiSignalId {
  if (snapshotOi <= 0 || snapshotPrice <= 0) return OiSignal.Neutral;

  const oiChangePct = ((currentOi - snapshotOi) / snapshotOi) * 100;
  const priceChangePct = ((currentPrice - snapshotPrice) / snapshotPrice) * 100;

  if (Math.abs(oiChangePct) < OI_THRESHOLD && Math.abs(priceChangePct) < PRICE_THRESHOLD) {
    return OiSignal.Neutral;
  }
  // If only one is below threshold, still classify but treat the below-threshold value as 0
  const effectiveOi = Math.abs(oiChangePct) >= OI_THRESHOLD ? oiChangePct : 0;
  const effectivePrice = Math.abs(priceChangePct) >= PRICE_THRESHOLD ? priceChangePct : 0;

  if (effectiveOi === 0 && effectivePrice === 0) return OiSignal.Neutral;

  return classifyOiSignal(effectiveOi, effectivePrice).signal;
}

/**
 * Compute volume confidence for a strike based on CE+PE volume vs average.
 * High: either leg > 1.5x avg volume (institutional activity)
 * Medium: either leg > 0.8x avg volume (normal activity)
 * Low: both legs below that but traded (thin, unreliable)
 * null: no volume data available
 */
function computeVolumeConfidence(
  ceToken: number | undefined,
  peToken: number | undefined,
  volumeData: Map<number, number>,
  avgVolume: number,
): VolumeConfidence {
  if (avgVolume <= 0 || volumeData.size === 0) return null;

  const ceVol = ceToken ? (volumeData.get(ceToken) || 0) : 0;
  const peVol = peToken ? (volumeData.get(peToken) || 0) : 0;
  const maxVol = Math.max(ceVol, peVol);

  if (maxVol > avgVolume * 1.5) return Confidence.High;
  if (maxVol > avgVolume * 0.8) return Confidence.Medium;
  if (maxVol > 0) return Confidence.Low;
  return null;
}

/**
 * Compute combined CE+PE signal for each strike in the visible chain.
 * Uses the most recent snapshot with price data as baseline.
 * Optionally incorporates volume data for confidence scoring.
 *
 * @returns Map keyed by strike number → StrikeSignal
 */
export function computeStrikeSignals(
  chain: OptionChainRow[],
  currentOi: Map<number, number>,
  currentPrices: Map<number, number>,
  snapshots: OiSnapshot[],
  volumeData?: Map<number, number>,
  avgVolume?: number,
): Map<number, StrikeSignal> {
  const result = new Map<number, StrikeSignal>();

  // Find the first snapshot of the day that has prices (stable baseline)
  let refSnapshot: OiSnapshot | null = null;
  for (let i = 0; i < snapshots.length; i++) {
    if (snapshots[i].prices && Object.keys(snapshots[i].prices!).length > 0) {
      refSnapshot = snapshots[i];
      break;
    }
  }

  if (!refSnapshot) return result;

  const volData = volumeData ?? new Map<number, number>();
  const avgVol = avgVolume ?? 0;

  for (const row of chain) {
    const ceToken = row.ce?.instrumentToken;
    const peToken = row.pe?.instrumentToken;

    let ceSignal: OiSignalId = OiSignal.Neutral;
    if (ceToken) {
      const curOi = currentOi.get(ceToken) || 0;
      const curPrice = currentPrices.get(ceToken) || 0;
      const snapOi = Number(refSnapshot.data[String(ceToken)] || 0);
      const snapPrice = Number(refSnapshot.prices![String(ceToken)] || 0);
      if (curOi > 0 && curPrice > 0) {
        ceSignal = classifyInstrument(ceToken, curOi, curPrice, snapOi, snapPrice);
      }
    }

    let peSignal: OiSignalId = OiSignal.Neutral;
    if (peToken) {
      const curOi = currentOi.get(peToken) || 0;
      const curPrice = currentPrices.get(peToken) || 0;
      const snapOi = Number(refSnapshot.data[String(peToken)] || 0);
      const snapPrice = Number(refSnapshot.prices![String(peToken)] || 0);
      if (curOi > 0 && curPrice > 0) {
        peSignal = classifyInstrument(peToken, curOi, curPrice, snapOi, snapPrice);
      }
    }

    const config = combineSignals(ceSignal, peSignal);
    const confidence = computeVolumeConfidence(ceToken, peToken, volData, avgVol);

    if (config.stance !== null) {
      result.set(row.strike, {
        stance: config.stance,
        ceSignal,
        peSignal,
        label: config.label,
        color: config.color,
        weak: config.weak || confidence === Confidence.Low,
        confidence,
      });
    }
  }

  return result;
}
