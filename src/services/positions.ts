/**
 * Positions Service
 * Manages paper trading positions via server-side REST API.
 * Netting logic (average-in, partial close, over-close) runs on the server.
 */
import { apiClient } from './apiClient';

export interface Position {
  id: string;
  mode: 'paper' | 'live';
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
  note?: string;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
  strategyTag?: string;
  confidence?: number | null;
}

export async function getPositions(mode: 'paper' | 'live' = 'paper'): Promise<Position[]> {
  return apiClient.get<Position[]>(`/api/positions?mode=${mode}`);
}

/**
 * Add a new position. Server handles netting:
 *   - Same-side existing → average in
 *   - Opposite-side existing → net out (exact, partial, or over-close)
 *   - No existing → open fresh
 */
export async function addPosition(
  position: Omit<Position, 'id' | 'entryTime' | 'mode'> & { mode?: 'paper' | 'live' },
): Promise<Position> {
  return apiClient.post<Position>('/api/positions', { ...position, mode: position.mode || 'paper' });
}

/**
 * Exit a position — marks it as exited with exit price and time.
 */
export async function exitPosition(id: string, exitPrice: number): Promise<void> {
  await apiClient.put(`/api/positions/${id}/exit`, { exitPrice });
}

/**
 * Remove a position by ID (permanently delete).
 */
export async function removePosition(id: string): Promise<void> {
  await apiClient.delete(`/api/positions/${id}`);
}

/**
 * Clear all positions for a given mode.
 */
export async function clearPositions(mode: 'paper' | 'live' = 'paper'): Promise<void> {
  await apiClient.delete(`/api/positions?mode=${mode}`);
}
