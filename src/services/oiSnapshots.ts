/**
 * Intraday OI Snapshots Service
 * The server takes the snapshots (every 10 minutes in market hours, shared
 * across all users); the browser only reads them.
 */
import { apiClient } from './apiClient';
import { istTimeLabel } from '@/utils/marketStatus';

export interface OiSnapshot {
  timestamp: number;
  timeLabel: string;
  data: Record<string, number>;
  prices?: Record<string, number>;  // token -> LTP
  close?: Record<string, number>;   // token -> previous day close
  spot?: number;                    // spot of the symbol being analysed (see withSpot)
  volumes?: Record<string, number>; // token -> volume
}

export interface OiVelocity {
  token: number;
  currentOi: number;
  prevOi: number;
  change: number;
  changePct: number;
  intervalMinutes: number;
  isHigh: boolean;
}

/**
 * Snapshots with `spot` set to one symbol's spot price. The server stores
 * each snapshotted symbol's spot in `prices` under its price instrument's
 * token, so this picks the analysed symbol's out (undefined if not captured).
 */
export function withSpot(snapshots: OiSnapshot[], spotToken: number | null): OiSnapshot[] {
  return snapshots.map((snap) => ({ ...snap, spot: spotToken !== null ? snap.prices?.[String(spotToken)] : undefined }));
}

/**
 * Ask the server to snapshot `symbol` for the rest of today; the
 * always-snapshot symbols always are. Resolves once the first snapshot (if any) is stored.
 */
export async function watchSnapshotSymbol(symbol: string, signal?: AbortSignal): Promise<void> {
  try {
    await apiClient.post('/api/oi-snapshots/watched-symbols', { symbol }, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[OI Snapshots] Could not start snapshots for ${symbol}:`, err);
  }
}

export async function getTodaySnapshots(signal?: AbortSignal): Promise<OiSnapshot[]> {
  try {
    const snapshots = await apiClient.get<OiSnapshot[]>('/api/oi-snapshots', { signal });
    return snapshots.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    if (signal?.aborted) throw err;
    return [];
  }
}

/** Timestamp of today's newest snapshot row, or null. Cheap to poll. */
export async function getLatestSnapshotTimestamp(signal?: AbortSignal): Promise<number | null> {
  const latest = await apiClient.get<{ timestamp: number | null }>('/api/oi-snapshots/latest', { signal });
  return latest?.timestamp ?? null;
}

export function calculateVelocity(
  currentOiData: Map<number, number>,
  snapshots: OiSnapshot[],
  threshold = 5,
): Map<number, OiVelocity> {
  const velocityMap = new Map<number, OiVelocity>();
  if (snapshots.length === 0) return velocityMap;

  const lastSnapshot = snapshots[snapshots.length - 1];
  const now = Date.now();
  const intervalMinutes = Math.round((now - lastSnapshot.timestamp) / 60000);

  if (intervalMinutes < 5) {
    if (snapshots.length < 2) return velocityMap;
    const prevSnapshot = snapshots[snapshots.length - 2];
    const interval = Math.round((lastSnapshot.timestamp - prevSnapshot.timestamp) / 60000);
    currentOiData.forEach((currentOi, token) => {
      const prevOi = Number(prevSnapshot.data[String(token)] || 0);
      if (!prevOi) return;
      const change = currentOi - prevOi;
      const changePct = (change / prevOi) * 100;
      velocityMap.set(token, { token, currentOi, prevOi, change, changePct, intervalMinutes: interval, isHigh: Math.abs(changePct) >= threshold });
    });
  } else {
    currentOiData.forEach((currentOi, token) => {
      const prevOi = Number(lastSnapshot.data[String(token)] || 0);
      if (!prevOi) return;
      const change = currentOi - prevOi;
      const changePct = (change / prevOi) * 100;
      velocityMap.set(token, { token, currentOi, prevOi, change, changePct, intervalMinutes, isHigh: Math.abs(changePct) >= threshold });
    });
  }

  return velocityMap;
}

export interface VelocityPattern {
  label: string;
  direction: 'up' | 'down' | 'neutral';
  /** Normalized OI values (0–1) across snapshots, newest last, for sparkline rendering */
  series: number[];
  /** Raw OI values at each snapshot time */
  rawSeries: number[];
  /** Time labels for each point in the series */
  timeLabels: string[];
}

/**
 * Analyzes the full intraday OI history for a token across all snapshots and
 * classifies the pattern: buildup/unwinding trend, acceleration, volatility.
 *
 * Returns null if fewer than 2 data points exist (no meaningful pattern).
 */
export function analyzeVelocityPattern(
  token: number,
  currentOi: number,
  snapshots: OiSnapshot[],
): VelocityPattern | null {
  // Build time-series: each snapshot + current value
  const key = String(token);
  const points: { oi: number; timeLabel: string }[] = [];

  for (const snap of snapshots) {
    const oi = Number(snap.data[key] || 0);
    if (oi > 0) points.push({ oi, timeLabel: snap.timeLabel });
  }

  // Append current OI as the latest point (with "now" label)
  if (currentOi > 0) {
    points.push({ oi: currentOi, timeLabel: istTimeLabel() });
  }

  if (points.length < 2) return null;

  const rawSeries = points.map((p) => p.oi);
  const timeLabels = points.map((p) => p.timeLabel);

  // Normalize to 0–1 for sparkline
  const minOi = Math.min(...rawSeries);
  const maxOi = Math.max(...rawSeries);
  const range = maxOi - minOi;
  const series = range > 0
    ? rawSeries.map((v) => (v - minOi) / range)
    : rawSeries.map(() => 0.5);

  // Compute per-interval deltas as % change
  const deltas: number[] = [];
  for (let i = 1; i < rawSeries.length; i++) {
    const prev = rawSeries[i - 1];
    deltas.push(prev > 0 ? ((rawSeries[i] - prev) / prev) * 100 : 0);
  }

  const STABLE_THRESHOLD = 1.5; // % change considered negligible

  const positiveDeltas = deltas.filter((d) => d > STABLE_THRESHOLD);
  const negativeDeltas = deltas.filter((d) => d < -STABLE_THRESHOLD);
  const neutralDeltas = deltas.filter((d) => Math.abs(d) <= STABLE_THRESHOLD);

  const totalDelta = rawSeries[rawSeries.length - 1] - rawSeries[0];
  const totalPct = rawSeries[0] > 0 ? (totalDelta / rawSeries[0]) * 100 : 0;

  // Determine dominant direction
  const isMostlyUp = positiveDeltas.length > negativeDeltas.length && positiveDeltas.length > neutralDeltas.length;
  const isMostlyDown = negativeDeltas.length > positiveDeltas.length && negativeDeltas.length > neutralDeltas.length;
  const isVolatile = positiveDeltas.length > 0 && negativeDeltas.length > 0
    && Math.abs(positiveDeltas.length - negativeDeltas.length) <= 1;

  let label: string;
  let direction: 'up' | 'down' | 'neutral';

  if (isVolatile && deltas.length >= 3) {
    label = 'Volatile';
    direction = totalPct > STABLE_THRESHOLD ? 'up' : totalPct < -STABLE_THRESHOLD ? 'down' : 'neutral';
  } else if (Math.abs(totalPct) <= STABLE_THRESHOLD && neutralDeltas.length >= deltas.length * 0.7) {
    label = 'Stable';
    direction = 'neutral';
  } else if (isMostlyUp) {
    // Check acceleration: are the deltas growing or shrinking?
    if (deltas.length >= 3) {
      const firstHalf = deltas.slice(0, Math.floor(deltas.length / 2));
      const secondHalf = deltas.slice(Math.floor(deltas.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d, 0) / secondHalf.length;
      if (secondAvg > firstAvg + 1) label = 'Accelerating Buildup';
      else if (secondAvg < firstAvg - 1) label = 'Slowing Buildup';
      else label = 'Steady Buildup';
    } else {
      label = 'Buildup';
    }
    direction = 'up';
  } else if (isMostlyDown) {
    if (deltas.length >= 3) {
      const firstHalf = deltas.slice(0, Math.floor(deltas.length / 2));
      const secondHalf = deltas.slice(Math.floor(deltas.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d, 0) / secondHalf.length;
      if (secondAvg < firstAvg - 1) label = 'Accelerating Unwind';
      else if (secondAvg > firstAvg + 1) label = 'Slowing Unwind';
      else label = 'Steady Unwind';
    } else {
      label = 'Unwinding';
    }
    direction = 'down';
  } else {
    // Leaning mixed
    label = totalPct > STABLE_THRESHOLD ? 'Mild Buildup' : totalPct < -STABLE_THRESHOLD ? 'Mild Unwind' : 'Stable';
    direction = totalPct > STABLE_THRESHOLD ? 'up' : totalPct < -STABLE_THRESHOLD ? 'down' : 'neutral';
  }

  return { label, direction, series, rawSeries, timeLabels };
}
