/**
 * Intraday OI Snapshots Service
 * Stores OI data every 15 minutes during market hours.
 * Calculates velocity (rate of OI change) between snapshots.
 */

const DB_NAME = 'optiontrap_cache';
const DB_VERSION = 2;
const SNAPSHOT_STORE = 'oi_snapshots';
const APP_STORE = 'app_data';
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface OiSnapshot {
  timestamp: number; // Unix ms
  timeLabel: string; // "09:15", "09:30", etc.
  data: Record<string, number>; // { instrumentToken: oi }
}

export interface OiVelocity {
  token: number;
  currentOi: number;
  prevOi: number;
  change: number; // absolute change
  changePct: number; // percentage change
  intervalMinutes: number; // time between snapshots
  isHigh: boolean; // velocity above threshold
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Keep existing store
      if (!db.objectStoreNames.contains(APP_STORE)) {
        db.createObjectStore(APP_STORE);
      }
      // Add snapshots store
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'timestamp' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * Get today's date string (YYYY-MM-DD) for filtering
 */
function getTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Get time label from timestamp (e.g., "09:15")
 */
function getTimeLabel(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Save an OI snapshot.
 */
export async function saveOiSnapshot(oiData: Map<number, number>): Promise<void> {
  if (oiData.size === 0) return;

  try {
    const db = await openDB();
    const timestamp = Date.now();
    const data: Record<string, number> = {};
    oiData.forEach((oi, token) => {
      data[String(token)] = oi;
    });

    const snapshot: OiSnapshot = {
      timestamp,
      timeLabel: getTimeLabel(timestamp),
      data,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(SNAPSHOT_STORE);
      store.put(snapshot);
      tx.oncomplete = () => {
        console.log(`[OI Snapshots] Saved snapshot at ${snapshot.timeLabel} with ${Object.keys(data).length} instruments`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OI Snapshots] Failed to save:', err);
  }
}

/**
 * Get all snapshots from today.
 */
export async function getTodaySnapshots(): Promise<OiSnapshot[]> {
  try {
    const db = await openDB();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    return new Promise((resolve) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
      const store = tx.objectStore(SNAPSHOT_STORE);
      const results: OiSnapshot[] = [];

      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const snapshot = cursor.value as OiSnapshot;
          if (snapshot.timestamp >= todayStartMs) {
            results.push(snapshot);
          }
          cursor.continue();
        } else {
          resolve(results.sort((a, b) => a.timestamp - b.timestamp));
        }
      };
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Clean up snapshots older than today (keep only today's data).
 */
export async function cleanOldSnapshots(): Promise<void> {
  try {
    const db = await openDB();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    return new Promise((resolve) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(SNAPSHOT_STORE);

      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const snapshot = cursor.value as OiSnapshot;
          if (snapshot.timestamp < todayStartMs) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
    });
  } catch {
    // Silently fail
  }
}

/**
 * Calculate OI velocity for all instruments by comparing the last two snapshots.
 * Returns a map of instrumentToken -> velocity info.
 * 
 * @param currentOiData Current live OI data
 * @param snapshots Today's snapshots (sorted by time)
 * @param threshold Percentage change to flag as "high velocity" (default 5%)
 */
export function calculateVelocity(
  currentOiData: Map<number, number>,
  snapshots: OiSnapshot[],
  threshold: number = 5,
): Map<number, OiVelocity> {
  const velocityMap = new Map<number, OiVelocity>();

  if (snapshots.length === 0) return velocityMap;

  // Use the most recent snapshot as the comparison point
  const lastSnapshot = snapshots[snapshots.length - 1];
  const now = Date.now();
  const intervalMinutes = Math.round((now - lastSnapshot.timestamp) / 60000);

  // Only calculate if at least 5 minutes have passed
  if (intervalMinutes < 5) {
    // Use second-to-last snapshot if available
    if (snapshots.length < 2) return velocityMap;
    const prevSnapshot = snapshots[snapshots.length - 2];
    const interval = Math.round((lastSnapshot.timestamp - prevSnapshot.timestamp) / 60000);

    currentOiData.forEach((currentOi, token) => {
      const prevOi = Number(prevSnapshot.data[String(token)] || 0);
      if (prevOi === 0) return;

      const change = currentOi - prevOi;
      const changePct = (change / prevOi) * 100;
      const isHigh = Math.abs(changePct) >= threshold;

      velocityMap.set(token, {
        token,
        currentOi,
        prevOi,
        change,
        changePct,
        intervalMinutes: interval,
        isHigh,
      });
    });
  } else {
    currentOiData.forEach((currentOi, token) => {
      const prevOi = Number(lastSnapshot.data[String(token)] || 0);
      if (prevOi === 0) return;

      const change = currentOi - prevOi;
      const changePct = (change / prevOi) * 100;
      const isHigh = Math.abs(changePct) >= threshold;

      velocityMap.set(token, {
        token,
        currentOi,
        prevOi,
        change,
        changePct,
        intervalMinutes,
        isHigh,
      });
    });
  }

  return velocityMap;
}

/**
 * Check if enough time has passed since the last snapshot to save a new one.
 */
export function shouldTakeSnapshot(snapshots: OiSnapshot[]): boolean {
  if (snapshots.length === 0) return true;
  const lastTimestamp = snapshots[snapshots.length - 1].timestamp;
  return (Date.now() - lastTimestamp) >= SNAPSHOT_INTERVAL_MS;
}

/**
 * Get the snapshot interval in milliseconds.
 */
export function getSnapshotInterval(): number {
  return SNAPSHOT_INTERVAL_MS;
}
