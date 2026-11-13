/**
 * Reads paper trading positions from the server's REST API. Positions are
 * opened and exited by orders (src/services/orders.ts); netting (average-in,
 * merging) runs on the server.
 */
import { apiClient, ApiError } from './apiClient';
import { InstrumentType, PositionStatus, TradingMode, type HorizonId, type InstrumentTypeId, type OptionTypeId, type SegmentId, type SideId, type TradeSourceId, type TradingModeId } from '../../shared/tradeEnums.js';

/**
 * What to tell the user when placing or exiting a trade failed: the server's
 * own reason when it gave one (e.g. the market is closed), otherwise `fallback`.
 */
export function tradeErrorMessage(err: unknown, fallback = 'Failed to add position'): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export interface Position {
  id: string;
  mode: TradingModeId;
  tradingsymbol: string;
  instrumentToken: number;
  /** CE / PE (options), FUT (futures), EQ (stocks). */
  instrumentType: InstrumentTypeId;
  exchange: string;
  /** manual: placed by the user; auto: by the trade automation. */
  source: TradeSourceId;
  /** Intraday or positional (shared/tradeEnums.js): only intraday positions are squared off, and trades merge only within one. */
  horizon: HorizonId;
  /** Options only. */
  strike: number | null;
  /** Options only: the same as instrumentType. */
  optionType: OptionTypeId | null;
  side: SideId;
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
export async function getPositions(mode: TradingModeId = TradingMode.Paper): Promise<Position[]> {
  return apiClient.get<Position[]>(`/api/positions?mode=${mode}`);
}

export interface ClosedPositionsFilter {
  /** Market-zone (IST) exit days, 'YYYY-MM-DD', inclusive. */
  from?: string;
  to?: string;
  segment?: SegmentId;
  /** Page size; the server defaults to 100 and allows at most 500. */
  limit?: number;
  offset?: number;
}

export interface DailyPnl {
  date: string; // market-zone exit day, 'YYYY-MM-DD'
  /** After charges. */
  pnl: number;
  /** The day's charges: what Zerodha would charge for its trades' entries and exits. */
  charges: number;
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
  mode: TradingModeId = TradingMode.Paper,
  filter: ClosedPositionsFilter = {},
): Promise<Position[]> {
  return apiClient.get<Position[]>(`/api/positions?${query({ mode, status: PositionStatus.Closed, ...filter })}`);
}

/**
 * P&L and trade count per exit day between `from` and `to`, newest day
 * first. Days without exits are left out.
 */
export async function getDailyPnl(
  mode: TradingModeId,
  from: string,
  to: string,
  segment?: SegmentId,
): Promise<DailyPnl[]> {
  return apiClient.get<DailyPnl[]>(`/api/positions/daily-pnl?${query({ mode, from, to, segment })}`);
}

export async function getPositionStats(mode: TradingModeId = TradingMode.Paper): Promise<PositionStats> {
  return apiClient.get<PositionStats>(`/api/positions/stats?${query({ mode })}`);
}

/**
 * A trade to open. instrumentType and exchange may be left out for an option
 * (the server takes them from optionType, on NFO). source is never sent: the
 * server records browser trades as manual.
 */
export type NewPosition = Omit<Position, 'id' | 'entryTime' | 'mode' | 'instrumentType' | 'exchange' | 'source'> & {
  mode?: TradingModeId;
  instrumentType?: Position['instrumentType'];
  exchange?: string;
};

/** Key for the quote API: the position's own exchange (NSE for stocks, NFO for F&O). */
export function positionQuoteKey(pos: Pick<Position, 'exchange' | 'tradingsymbol'>): string {
  return `${pos.exchange}:${pos.tradingsymbol}`;
}

/** Name to show: a stock's symbol, or an F&O contract's underlying (NIFTY26NOV24000CE → NIFTY). */
export function instrumentName(pos: Pick<Position, 'instrumentType' | 'tradingsymbol'>): string {
  return pos.instrumentType === InstrumentType.EQ ? pos.tradingsymbol : pos.tradingsymbol.replace(/\d.*/, '');
}
