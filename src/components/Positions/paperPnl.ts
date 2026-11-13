import type { Position } from '@/services/positions';
import { Side } from '../../../shared/tradeEnums.js';

export interface PaperPnl { value: number; pct: number }

/** A paper position's P&L and % move at its exit price, or at the live price while open (zero while unpriced). */
export function paperPositionPnl(pos: Position, livePrice: number | undefined): PaperPnl {
  const price = pos.exited ? pos.exitPrice! : livePrice;
  if (price === undefined) return { value: 0, pct: 0 };
  const move = pos.side === Side.BUY ? price - pos.entryPrice : pos.entryPrice - price;
  return { value: move * pos.quantity, pct: pos.entryPrice > 0 ? (move / pos.entryPrice) * 100 : 0 };
}

export const paperPositionsPnl = (positions: Position[], livePrices: Map<number, number>): number =>
  positions.reduce((sum, pos) => sum + paperPositionPnl(pos, livePrices.get(pos.instrumentToken)).value, 0);
