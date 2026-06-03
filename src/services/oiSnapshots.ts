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
