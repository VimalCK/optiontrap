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
  /** CE / PE (options), FUT (futures), EQ (stocks). */
  instrumentType: 'CE' | 'PE' | 'FUT' | 'EQ';
  exchange: string;
  /** manual: placed by the user; auto: by the trade automation. */
  source: 'manual' | 'auto';
  /** Options only. */
  strike: number | null;
  /** Options only: the same as instrumentType. */
  optionType: 'CE' | 'PE' | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  entryTime: string; // ISO timestamp
  /** Options and futures only. */
  expiry: string | null;
  exited?: boolean;
  exitPrice?: number;
  exitTime?: string;
  note?: string;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
  strategyTag?: string;
  confidence?: number | null;
  /** What Zerodha would charge for its entry and exit (shared/paperCharges.js); set when it closes. */
  charges?: number | null;
  chargeBreakdown?: ChargeBreakdown | null;
}

/** Each charge on a closed paper position, in ₹ (shared/paperCharges.js). */
export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
  dp: number;
  total: number;
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
  segment?: 'options' | 'futures' | 'stocks';
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
 * P&L and trade count per exit day between `from` and `to`, newest day
 * first. Days without exits are left out.
 */
export async function getDailyPnl(
  mode: 'paper' | 'live',
  from: string,
  to: string,
  segment?: 'options' | 'futures' | 'stocks',
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
/**
 * A trade to open. instrumentType and exchange may be left out for an option
 * (the server takes them from optionType, on NFO). source is never sent: the
 * server records browser trades as manual.
 */
export type NewPosition = Omit<Position, 'id' | 'entryTime' | 'mode' | 'instrumentType' | 'exchange' | 'source'> & {
  mode?: 'paper' | 'live';
  instrumentType?: Position['instrumentType'];
  exchange?: string;
};

export async function addPosition(position: NewPosition): Promise<Position> {
  return apiClient.post<Position>('/api/positions', { ...position, mode: position.mode || 'paper' });
}

/**
 * Exit a position — marks it as exited with exit price and time.
 */
export async function exitPosition(id: string, exitPrice: number): Promise<void> {
  await apiClient.patch(`/api/positions/${id}`, { exitPrice });
}

/** Key for the quote API: the position's own exchange (NSE for stocks, NFO for F&O). */
export function positionQuoteKey(pos: Pick<Position, 'exchange' | 'tradingsymbol'>): string {
  return `${pos.exchange}:${pos.tradingsymbol}`;
}

/** Name to show: a stock's symbol, or an F&O contract's underlying (NIFTY26NOV24000CE → NIFTY). */
export function instrumentName(pos: Pick<Position, 'instrumentType' | 'tradingsymbol'>): string {
  return pos.instrumentType === 'EQ' ? pos.tradingsymbol : pos.tradingsymbol.replace(/\d.*/, '');
}
