/**
 * Positions Service
 * Manages paper trading positions via server-side REST API.
 * Netting logic (average-in, partial close, over-close) runs on the server.
 */
import { apiClient, ApiError } from './apiClient';

/**
 * What to tell the user when placing or exiting a trade failed: the server's
 * own reason when it gave one (e.g. the market is closed), otherwise `fallback`.
 */
export function tradeErrorMessage(err: unknown, fallback = 'Failed to add position'): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

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

/**
 * Open positions plus those exited today.
 */
export async function getPositions(mode: 'paper' | 'live' = 'paper'): Promise<Position[]> {
  return apiClient.get<Position[]>(`/api/positions?mode=${mode}`);
}

export interface ClosedPositionsFilter {
  /** Market-zone (IST) exit days, 'YYYY-MM-DD', inclusive. */
  from?: string;
  to?: string;
  segment?: 'options' | 'stocks';
  /** Page size; the server defaults to 100 and allows at most 500. */
  limit?: number;
  offset?: number;
}

export interface DailyPnl {
  date: string; // market-zone exit day, 'YYYY-MM-DD'
  pnl: number;
  trades: number;
}

export interface PositionStats {
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  todayTrades: number;
  bestTrade: Position | null;
  worstTrade: Position | null;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

/**
 * A page of exited positions, most recently exited first.
 */
export async function getClosedPositions(
  mode: 'paper' | 'live' = 'paper',
  filter: ClosedPositionsFilter = {},
): Promise<Position[]> {
  return apiClient.get<Position[]>(`/api/positions?${query({ mode, status: 'closed', ...filter })}`);
}

/**
 * P&L and trade count per exit day between `from` and `to` (at most 366 days
 * apart), newest day first. Days without exits are left out.
 */
export async function getDailyPnl(
  mode: 'paper' | 'live',
  from: string,
  to: string,
  segment?: 'options' | 'stocks',
): Promise<DailyPnl[]> {
  return apiClient.get<DailyPnl[]>(`/api/positions/daily-pnl?${query({ mode, from, to, segment })}`);
}

/**
 * All-time win/loss figures over exited positions.
 */
export async function getPositionStats(mode: 'paper' | 'live' = 'paper'): Promise<PositionStats> {
  return apiClient.get<PositionStats>(`/api/positions/stats?${query({ mode })}`);
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
  await apiClient.patch(`/api/positions/${id}`, { exitPrice });
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
