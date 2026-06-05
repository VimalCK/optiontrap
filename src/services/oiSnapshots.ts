/**
 * Intraday OI Snapshots Service
 * Uses unified "optiontrap" DB → oi_snapshots store.
 */

import { dbPutNoKey, dbGetAllCursor, dbDeleteCursor, STORE_OI } from './db';

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Module-level counter used to break timestamp ties. Appended as the last
// digit of the millisecond value so the timestamp stays usable for date
// comparisons and getTimeLabel() while the key is always unique.
let _snapshotSeq = 0;

export interface OiSnapshot {
  timestamp: number;
  timeLabel: string;
  data: Record<string, number>;
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

function getTimeLabel(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function saveOiSnapshot(oiData: Map<number, number>): Promise<void> {
  if (oiData.size === 0) return;
  // Use Date.now() rounded down to the nearest 10 ms, then append a 0-9
  // sequence digit. This keeps the value within ~10 ms of real time (well
  // within the same minute for getTimeLabel) while guaranteeing uniqueness
  // across up to 10 concurrent saves — far more than can realistically occur.
  const base = Math.floor(Date.now() / 10) * 10;
  const timestamp = base + (_snapshotSeq++ % 10);
  const data: Record<string, number> = {};
  oiData.forEach((oi, token) => { data[String(token)] = oi; });
  const snapshot: OiSnapshot = { timestamp, timeLabel: getTimeLabel(timestamp), data };
  await dbPutNoKey(STORE_OI, snapshot);
  console.log(`[OI Snapshots] Saved at ${snapshot.timeLabel} (${Object.keys(data).length} instruments)`);
}

export async function getTodaySnapshots(): Promise<OiSnapshot[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const results = await dbGetAllCursor<OiSnapshot>(
    STORE_OI,
    (s) => s.timestamp >= todayStartMs,
  );
  return results.sort((a, b) => a.timestamp - b.timestamp);
}

export async function cleanOldSnapshots(): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  await dbDeleteCursor(STORE_OI, (v) => (v as OiSnapshot).timestamp < todayStartMs);
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

export function shouldTakeSnapshot(snapshots: OiSnapshot[]): boolean {
  if (snapshots.length === 0) return true;
  return (Date.now() - snapshots[snapshots.length - 1].timestamp) >= SNAPSHOT_INTERVAL_MS;
}

export function getSnapshotInterval(): number {
  return SNAPSHOT_INTERVAL_MS;
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
    const now = new Date();
    const nowLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    points.push({ oi: currentOi, timeLabel: nowLabel });
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
