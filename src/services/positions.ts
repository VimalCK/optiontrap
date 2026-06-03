/**
 * Positions Service
 * Manages open option positions stored in IndexedDB.
 *
 * All write operations go through a serial queue (mutex) to prevent
 * the read→modify→write race condition that can cause data loss when
 * two operations are triggered in rapid succession.
 */

import { cacheGet, cacheSet } from './cacheDb';

export interface Position {
  id: string;
  tradingsymbol: string;
  instrumentToken: number;
  strike: number;
  optionType: 'CE' | 'PE';
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  entryTime: string; // ISO timestamp
  expiry: string;
  exited?: boolean;
  exitPrice?: number;
  exitTime?: string;
}

const POSITIONS_KEY = 'open_positions';

// ── Mutex queue ───────────────────────────────────────────────────────────────
// Ensures all read→modify→write operations run serially, never concurrently.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn); // run even if previous step failed
  queue = next.then(
    () => {},
    () => {}, // swallow to keep queue alive
  );
  return next;
}

// ── Read (no queue needed — reads are safe to run concurrently) ───────────────

export async function getPositions(): Promise<Position[]> {
  const positions = await cacheGet<Position[]>(POSITIONS_KEY);
  return positions || [];
}

// ── Writes (all serialised through the queue) ─────────────────────────────────

/**
 * Add a new position or average into an existing one.
 * If the same instrument + side already exists, averages the price and adds qty.
 */
export function addPosition(
  position: Omit<Position, 'id' | 'entryTime'>,
): Promise<Position> {
  return enqueue(async () => {
    const positions = await getPositions();

    const existingIdx = positions.findIndex(
      (p) =>
        p.instrumentToken === position.instrumentToken &&
        p.side === position.side &&
        !p.exited,
    );

    if (existingIdx >= 0) {
      const existing = positions[existingIdx];
      const totalQty = existing.quantity + position.quantity;
      const avgPrice =
        (existing.entryPrice * existing.quantity +
          position.entryPrice * position.quantity) /
        totalQty;
      positions[existingIdx] = {
        ...existing,
        quantity: totalQty,
        entryPrice: Number(avgPrice.toFixed(2)),
      };
      await cacheSet(POSITIONS_KEY, positions);
      return positions[existingIdx];
    }

    const newPosition: Position = {
      ...position,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      entryTime: new Date().toISOString(),
    };
    positions.push(newPosition);
    await cacheSet(POSITIONS_KEY, positions);
    return newPosition;
  });
}

/**
 * Exit a position — marks it as exited with exit price and time.
 */
export function exitPosition(id: string, exitPrice: number): Promise<void> {
  return enqueue(async () => {
    const positions = await getPositions();
    const idx = positions.findIndex((p) => p.id === id);
    if (idx >= 0) {
      positions[idx] = {
        ...positions[idx],
        exited: true,
        exitPrice,
        exitTime: new Date().toISOString(),
      };
      await cacheSet(POSITIONS_KEY, positions);
    }
  });
}

/**
 * Remove a position by ID (permanently delete).
 */
export function removePosition(id: string): Promise<void> {
  return enqueue(async () => {
    const positions = await getPositions();
    await cacheSet(
      POSITIONS_KEY,
      positions.filter((p) => p.id !== id),
    );
  });
}

/**
 * Clear all positions.
 */
export function clearPositions(): Promise<void> {
  return enqueue(async () => {
    await cacheSet(POSITIONS_KEY, []);
  });
}
