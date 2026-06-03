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
 * Add a new position or average into existing one.
 * If same instrument + side exists, averages the entry price and adds quantity.
 */
export async function addPosition(position: Omit<Position, 'id' | 'entryTime'>): Promise<Position> {
  const positions = await getPositions();
  
  // Check if same instrument + side already exists
  const existingIdx = positions.findIndex(
    (p) => p.instrumentToken === position.instrumentToken && p.side === position.side
  );

  if (existingIdx >= 0) {
    // Average the price
    const existing = positions[existingIdx];
    const totalQty = existing.quantity + position.quantity;
    const avgPrice = ((existing.entryPrice * existing.quantity) + (position.entryPrice * position.quantity)) / totalQty;
    positions[existingIdx] = {
      ...existing,
      quantity: totalQty,
      entryPrice: Number(avgPrice.toFixed(2)),
    };
    await cacheSet(POSITIONS_KEY, positions);
    return positions[existingIdx];
  }

  // New position
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
