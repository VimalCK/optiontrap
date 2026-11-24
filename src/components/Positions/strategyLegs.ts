import type { Position } from '@/services/positions';
import { TradeSource } from '../../../shared/tradeEnums.js';

/**
 * A row of the positions table: one position, or the open automated positions several strategies hold in the same
 * instrument, combined as the broker nets them, with each strategy's own position (its leg) under it.
 */
export interface PositionRow {
  /** The position shown: the one position, or the legs combined (summed quantity at the average price). */
  position: Position;
  /** Each strategy's own position; empty for a single position. */
  legs: Position[];
}

/** Open automated positions that combine: the same instrument, side, mode and horizon, each strategy's own. */
const legKey = (pos: Position) =>
  (pos.source === TradeSource.Auto && !pos.exited && pos.strategyId ? `${pos.mode}|${pos.instrumentToken}|${pos.side}|${pos.horizon}` : null);

/** The legs as one position: their quantity summed at the average entry price, entered when the first was. */
export function combinedPosition(legs: Position[]): Position {
  const quantity = legs.reduce((total, leg) => total + leg.quantity, 0);
  const cost = legs.reduce((total, leg) => total + leg.entryPrice * leg.quantity, 0);
  const first = legs.reduce((earliest, leg) => (leg.entryTime < earliest.entryTime ? leg : earliest));
  return { ...first, id: legs.map((leg) => leg.id).join('+'), strategyId: null, quantity, entryPrice: cost / quantity };
}

/**
 * The table's rows, in the positions' order: open automated positions of different strategies in the same
 * instrument become one combined row (where the first of them was), every other position a row of its own.
 */
export function positionRows(positions: Position[]): PositionRow[] {
  const legsByKey = new Map<string, Position[]>();
  for (const pos of positions) {
    const key = legKey(pos);
    if (key) legsByKey.set(key, [...(legsByKey.get(key) ?? []), pos]);
  }
  const rows: PositionRow[] = [];
  for (const pos of positions) {
    const legs = legsByKey.get(legKey(pos) ?? '') ?? [];
    if (legs.length < 2) rows.push({ position: pos, legs: [] });
    else if (legs[0] === pos) rows.push({ position: combinedPosition(legs), legs });
  }
  return rows;
}
