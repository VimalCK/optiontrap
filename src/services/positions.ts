/**
 * Positions Service
 * Manages open option positions stored in IndexedDB.
 * In future, this will be replaced by Kite Positions API.
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
}

const POSITIONS_KEY = 'open_positions';

/**
 * Get all open positions.
 */
export async function getPositions(): Promise<Position[]> {
  const positions = await cacheGet<Position[]>(POSITIONS_KEY);
  return positions || [];
}

/**
 * Add a new position.
 */
export async function addPosition(position: Omit<Position, 'id' | 'entryTime'>): Promise<Position> {
  const positions = await getPositions();
  const newPosition: Position = {
    ...position,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    entryTime: new Date().toISOString(),
  };
  positions.push(newPosition);
  await cacheSet(POSITIONS_KEY, positions);
  return newPosition;
}

/**
 * Remove a position by ID (close/exit).
 */
export async function removePosition(id: string): Promise<void> {
  const positions = await getPositions();
  const filtered = positions.filter((p) => p.id !== id);
  await cacheSet(POSITIONS_KEY, filtered);
}

/**
 * Clear all positions.
 */
export async function clearPositions(): Promise<void> {
  await cacheSet(POSITIONS_KEY, []);
}
