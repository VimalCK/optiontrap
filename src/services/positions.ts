/**
 * Positions Service
 * Manages paper trading positions via server-side REST API.
 * Netting logic (average-in, partial close, over-close) runs on the server.
 */

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
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...options });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Request failed (${res.status})`);
  }

  const json = await res.json();
  return json.data as T;
}

export async function getPositions(mode: 'paper' | 'live' = 'paper'): Promise<Position[]> {
  return request<Position[]>(`/api/positions?mode=${mode}`);
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
  return request<Position>('/api/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...position, mode: position.mode || 'paper' }),
  });
}

/**
 * Exit a position — marks it as exited with exit price and time.
 */
export async function exitPosition(id: string, exitPrice: number): Promise<void> {
  await request<void>(`/api/positions/${id}/exit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exitPrice }),
  });
}

/**
 * Remove a position by ID (permanently delete).
 */
export async function removePosition(id: string): Promise<void> {
  await request<void>(`/api/positions/${id}`, { method: 'DELETE' });
}

/**
 * Clear all positions for a given mode.
 */
export async function clearPositions(mode: 'paper' | 'live' = 'paper'): Promise<void> {
  await request<void>(`/api/positions?mode=${mode}`, { method: 'DELETE' });
}
