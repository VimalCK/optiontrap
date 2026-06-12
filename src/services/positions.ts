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
 * Add a new position, average into an existing same-side position, or net
 * against an existing opposite-side position on the same instrument.
 *
 * Netting rules:
 *   opposite qty == existing qty  → closes the existing position
 *   opposite qty <  existing qty  → reduces existing qty (partial close)
 *   opposite qty >  existing qty  → closes existing, opens remainder in new side
 */
export function addPosition(
  position: Omit<Position, 'id' | 'entryTime'>,
): Promise<Position> {
  return enqueue(async () => {
    const positions = await getPositions();
    const now = new Date().toISOString();

    // Look for an open position on the SAME side (average-in)
    const sameSideIdx = positions.findIndex(
      (p) =>
        p.instrumentToken === position.instrumentToken &&
        p.side === position.side &&
        !p.exited,
    );

    if (sameSideIdx >= 0) {
      const existing = positions[sameSideIdx];
      const totalQty = existing.quantity + position.quantity;
      const avgPrice =
        (existing.entryPrice * existing.quantity +
          position.entryPrice * position.quantity) /
        totalQty;
      positions[sameSideIdx] = {
        ...existing,
        quantity: totalQty,
        entryPrice: Number(avgPrice.toFixed(2)),
      };
      await cacheSet(POSITIONS_KEY, positions);
      return positions[sameSideIdx];
    }

    // Look for an open position on the OPPOSITE side (net out)
    const oppSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    const oppIdx = positions.findIndex(
      (p) =>
        p.instrumentToken === position.instrumentToken &&
        p.side === oppSide &&
        !p.exited,
    );

    if (oppIdx >= 0) {
      const existing = positions[oppIdx];

      if (position.quantity === existing.quantity) {
        // Exact close — mark existing exited
        positions[oppIdx] = {
          ...existing,
          exited: true,
          exitPrice: position.entryPrice,
          exitTime: now,
        };
        await cacheSet(POSITIONS_KEY, positions);
        return positions[oppIdx];
      }

      if (position.quantity < existing.quantity) {
        // Partial close — reduce existing qty
        positions[oppIdx] = {
          ...existing,
          quantity: existing.quantity - position.quantity,
        };
        await cacheSet(POSITIONS_KEY, positions);
        return positions[oppIdx];
      }

      // Over-close — close existing, open remainder in new side
      positions[oppIdx] = {
        ...existing,
        exited: true,
        exitPrice: position.entryPrice,
        exitTime: now,
      };
      const remainder: Position = {
        ...position,
        quantity: position.quantity - existing.quantity,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        entryTime: now,
      };
      positions.push(remainder);
      await cacheSet(POSITIONS_KEY, positions);
      return remainder;
    }

    // No existing position — open fresh
    const newPosition: Position = {
      ...position,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      entryTime: now,
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
