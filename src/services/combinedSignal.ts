/**
 * Combined OI Signal Service
 * Classifies CE + PE OI+Price signals per strike and combines them
 * into a single market stance for the OI chart signal strip.
 */

import { classifyOiSignal, OiSignal } from './trapAnalysis';
import { OiSnapshot } from './oiSnapshots';
import { OptionChainRow } from './optionChain';

export type CombinedStance =
  | 'strong-bullish' | 'bullish' | 'bullish-weak'
  | 'strong-bearish' | 'bearish' | 'bearish-weak'
  | 'pinning' | 'high-volatility' | 'breakout'
  | 'de-risking' | 'transitional'
  | 'fading-bull' | 'fading-bear'
  | null;

export type VolumeConfidence = 'high' | 'medium' | 'low' | null;

export interface StrikeSignal {
  stance: CombinedStance;
  ceSignal: OiSignal;
  peSignal: OiSignal;
  label: string;
  color: string;
  weak: boolean;  // true for single-leg (0.5 opacity) stances
  confidence: VolumeConfidence;  // volume-based confidence level
}

const OI_THRESHOLD = 2;      // % minimum OI change to count as signal
const PRICE_THRESHOLD = 0.5; // % minimum price change to count as signal

interface StanceConfig {
  stance: CombinedStance;
  label: string;
  color: string;
  weak: boolean;
}

/**
 * Look up the combined stance from CE + PE individual signals.
 */
function combineSignals(ceSignal: OiSignal, peSignal: OiSignal): StanceConfig {
  const key = `${ceSignal}|${peSignal}`;

  // Both-leg combinations (strong signals)
  const bothLeg: Record<string, StanceConfig> = {
    'short-buildup|short-buildup':   { stance: 'pinning',          label: 'Pinning/Range',    color: '#f59e0b', weak: false },
    'long-buildup|short-buildup':    { stance: 'bullish',          label: 'Bullish',          color: '#4ade80', weak: false },
    'short-buildup|long-buildup':    { stance: 'bearish',          label: 'Bearish',          color: '#f87171', weak: false },
    'long-buildup|long-buildup':     { stance: 'high-volatility',  label: 'High Volatility',  color: '#a78bfa', weak: false },
    'short-covering|short-covering': { stance: 'breakout',         label: 'Breakout Setup',   color: '#a78bfa', weak: false },
    'long-unwinding|long-unwinding': { stance: 'de-risking',       label: 'De-risking',       color: '#94a3b8', weak: false },
    'long-buildup|short-covering':   { stance: 'strong-bullish',   label: 'Strong Bullish',   color: '#22c55e', weak: false },
    'short-covering|long-buildup':   { stance: 'strong-bearish',   label: 'Strong Bearish',   color: '#ef4444', weak: false },
  };

  if (bothLeg[key]) return bothLeg[key];

  // Single-leg: CE active, PE neutral
  if (peSignal === 'neutral') {
    switch (ceSignal) {
      case 'long-buildup':   return { stance: 'bullish-weak',  label: 'Bullish (weak)',  color: '#4ade80', weak: true };
      case 'short-buildup':  return { stance: 'bearish-weak',  label: 'Bearish (weak)',  color: '#f87171', weak: true };
      case 'long-unwinding': return { stance: 'fading-bull',   label: 'Fading Bull',     color: '#94a3b8', weak: true };
      case 'short-covering': return { stance: 'fading-bear',   label: 'Fading Bear',     color: '#94a3b8', weak: true };
    }
  }

  // Single-leg: PE active, CE neutral
  if (ceSignal === 'neutral') {
    switch (peSignal) {
      case 'long-buildup':   return { stance: 'bearish-weak',  label: 'Bearish (weak)',  color: '#f87171', weak: true };
      case 'short-buildup':  return { stance: 'bullish-weak',  label: 'Bullish (weak)',  color: '#4ade80', weak: true };
      case 'long-unwinding': return { stance: 'fading-bear',   label: 'Fading Bear',     color: '#94a3b8', weak: true };
      case 'short-covering': return { stance: 'fading-bull',   label: 'Fading Bull',     color: '#94a3b8', weak: true };
    }
  }

  // Both neutral
  if (ceSignal === 'neutral' && peSignal === 'neutral') {
    return { stance: null, label: '', color: 'transparent', weak: false };
  }

  // Mixed / transitional (all other combinations)
  return { stance: 'transitional', label: 'Transitional', color: '#64748b', weak: false };
}

/**
 * Classify a single instrument's OI+Price change vs the last snapshot.
 * Returns 'neutral' if below thresholds.
 */
function classifyInstrument(
  _token: number,
  currentOi: number,
  currentPrice: number,
  snapshotOi: number,
  snapshotPrice: number,
): OiSignal {
  if (snapshotOi <= 0 || snapshotPrice <= 0) return 'neutral';

  const oiChangePct = ((currentOi - snapshotOi) / snapshotOi) * 100;
  const priceChangePct = ((currentPrice - snapshotPrice) / snapshotPrice) * 100;

  // Filter noise
  if (Math.abs(oiChangePct) < OI_THRESHOLD && Math.abs(priceChangePct) < PRICE_THRESHOLD) {
    return 'neutral';
  }
  // If only one is below threshold, still classify but treat the below-threshold value as 0
  const effectiveOi = Math.abs(oiChangePct) >= OI_THRESHOLD ? oiChangePct : 0;
  const effectivePrice = Math.abs(priceChangePct) >= PRICE_THRESHOLD ? priceChangePct : 0;

  if (effectiveOi === 0 && effectivePrice === 0) return 'neutral';

  return classifyOiSignal(effectiveOi, effectivePrice).signal;
}

/**
 * Compute volume confidence for a strike based on CE+PE volume vs average.
 * high: either leg > 1.5x avg volume (institutional activity)
 * medium: either leg > 0.8x avg volume (normal activity)
 * low: both legs < 0.5x avg volume (thin, unreliable)
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

  if (maxVol > avgVolume * 1.5) return 'high';
  if (maxVol > avgVolume * 0.8) return 'medium';
  if (maxVol > 0) return 'low';
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

  if (!refSnapshot) return result; // No snapshot with prices yet — no signals

  const volData = volumeData ?? new Map<number, number>();
  const avgVol = avgVolume ?? 0;

  for (const row of chain) {
    const ceToken = row.ce?.instrumentToken;
    const peToken = row.pe?.instrumentToken;

    // Classify CE
    let ceSignal: OiSignal = 'neutral';
    if (ceToken) {
      const curOi = currentOi.get(ceToken) || 0;
      const curPrice = currentPrices.get(ceToken) || 0;
      const snapOi = Number(refSnapshot.data[String(ceToken)] || 0);
      const snapPrice = Number(refSnapshot.prices![String(ceToken)] || 0);
      if (curOi > 0 && curPrice > 0) {
        ceSignal = classifyInstrument(ceToken, curOi, curPrice, snapOi, snapPrice);
      }
    }

    // Classify PE
    let peSignal: OiSignal = 'neutral';
    if (peToken) {
      const curOi = currentOi.get(peToken) || 0;
      const curPrice = currentPrices.get(peToken) || 0;
      const snapOi = Number(refSnapshot.data[String(peToken)] || 0);
      const snapPrice = Number(refSnapshot.prices![String(peToken)] || 0);
      if (curOi > 0 && curPrice > 0) {
        peSignal = classifyInstrument(peToken, curOi, curPrice, snapOi, snapPrice);
      }
    }

    // Combine
    const config = combineSignals(ceSignal, peSignal);
    const confidence = computeVolumeConfidence(ceToken, peToken, volData, avgVol);

    if (config.stance !== null) {
      result.set(row.strike, {
        stance: config.stance,
        ceSignal,
        peSignal,
        label: config.label,
        color: config.color,
        weak: config.weak || confidence === 'low',
        confidence,
      });
    }
  }

  return result;
}
