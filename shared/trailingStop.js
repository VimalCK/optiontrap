/**
 * The trailing stop-loss, shared by the trade monitor's channels: it starts once the position's gain reaches its
 * target, then follows the best gain and fires once the gain falls back `trail` from it. Gains are ₹ per unit from the
 * entry price, for manual and automated positions alike.
 */
import { Side } from './tradeEnums.js';

/**
 * The better of a position's best price so far and a new price: the highest for a buy, the lowest for a sell.
 * @param {import('./tradeEnums.js').SideId} side
 * @param {number | undefined} best  undefined before the first price
 * @param {number} price
 */
export function betterPrice(side, best, price) {
  if (best === undefined) return price;
  return side === Side.BUY ? Math.max(best, price) : Math.min(best, price);
}

/**
 * @param {{ best: number, current: number, start: number, trail: number }} gains
 *   best: the best gain so far (current included); start: the target's gain, where it starts
 */
export const trailingStopHit = ({ best, current, start, trail }) => best >= start && current <= best - trail;
