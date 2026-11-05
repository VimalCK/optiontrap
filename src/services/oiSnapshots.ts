/**
 * Intraday OI Snapshots Service
 * The server takes the snapshots (every 10 minutes in market hours, shared
 * across all users); the browser only reads them.
 */
import { apiClient } from './apiClient';

import type { OiSnapshot } from '../../shared/optionAnalysis/velocityPattern.js';

/** The snapshot type and the OI velocity pattern live in shared/, used by the trade engine too. */
export * from '../../shared/optionAnalysis/velocityPattern.js';

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

