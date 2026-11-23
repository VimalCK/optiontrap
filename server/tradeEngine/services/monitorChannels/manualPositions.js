/**
 * The trade monitor's manual channel: open manual paper positions with a target or stop-loss from their order
 * (the order popup), exited when the price reaches them. With a trailing stop-loss (trailAmount, ₹), reaching the
 * target starts it instead of exiting: the position then exits once the price falls back that much from its best.
 * Prices only: no user settings, no daily totals, nothing shared with the automated channel.
 */
import { getAllOpenManualPositionsWithExits, getOpenManualPositionsWithExits } from '../../../db.js';
import { STOP_LOSS_RULE_ID } from '../../../../shared/exitRules/stopLoss.js';
import { TARGET_RULE_ID } from '../../../../shared/exitRules/target.js';
import { trailingStopHit } from '../../../../shared/trailingStop.js';
import { tradePnl } from '../../../../shared/tradePnl.js';
import { TradeSource } from '../../../../shared/tradeEnums.js';
import { createPositionBook } from './positionBook.js';

/**
 * @typedef {import('../tradeMonitor.js').WatchedPosition & { targetPrice: number | null, stopLossPrice: number | null,
 *   trailAmount: number | null }} ManualPosition
 * @typedef {import('../tradeMonitor.js').MonitorPrices} MonitorPrices
 */

/** The gain per unit at `price`: what the levels compare, the same way for a buy and a sell. */
const gainAt = (/** @type {ManualPosition} */ position, /** @type {number} */ price) =>
  tradePnl({ side: position.side, quantity: 1, entryPrice: position.entryPrice }, price);

const isSet = (/** @type {number | null | undefined} */ price) => price !== null && price !== undefined;

/**
 * Whether a manual position's own levels close it at `price`, and why.
 * @param {ManualPosition} position
 * @param {number} price  its last price
 * @param {number} bestPrice  its best price while watched, `price` included
 * @returns {{ ruleId: string, reason: string } | null}
 */
export function manualExit(position, price, bestPrice) {
  const { targetPrice, stopLossPrice, trailAmount } = position;
  const gain = gainAt(position, price);
  if (isSet(stopLossPrice) && gain <= gainAt(position, /** @type {number} */ (stopLossPrice))) {
    return { ruleId: STOP_LOSS_RULE_ID, reason: `Stop-loss hit (₹${stopLossPrice})` };
  }
  if (!isSet(targetPrice)) return null;
  const targetGain = gainAt(position, /** @type {number} */ (targetPrice));
  if (!isSet(trailAmount)) return gain >= targetGain ? { ruleId: TARGET_RULE_ID, reason: `Target hit (₹${targetPrice})` } : null;
  const hit = trailingStopHit({ best: gainAt(position, bestPrice), current: gain, start: targetGain, trail: /** @type {number} */ (trailAmount) });
  return hit ? { ruleId: TARGET_RULE_ID, reason: `Trailing stop-loss hit (best ₹${bestPrice}, trail ₹${trailAmount}, target ₹${targetPrice})` } : null;
}

/**
 * @param {{
 *   db?: { getAllOpenManualPositionsWithExits: typeof getAllOpenManualPositionsWithExits,
 *          getOpenManualPositionsWithExits: typeof getOpenManualPositionsWithExits },
 *   prices: MonitorPrices,
 * }} deps
 * @returns {import('../tradeMonitor.js').MonitorChannel}
 */
export function createManualChannel({ db = { getAllOpenManualPositionsWithExits, getOpenManualPositionsWithExits }, prices }) {
  const book = createPositionBook();

  return {
    source: TradeSource.Manual,
    positions: book.values,

    async loadAll() {
      book.replaceAll(await db.getAllOpenManualPositionsWithExits());
    },

    async loadUser(userId) {
      book.replaceUsers([userId], await db.getOpenManualPositionsWithExits(userId));
    },

    dueExits(positions) {
      return positions.flatMap((position) => {
        const price = prices.last.get(position.instrumentToken);
        if (price === undefined) return [];
        const fired = manualExit(/** @type {ManualPosition} */ (position), price, prices.best.get(position.id) ?? price);
        return fired ? [{ position, exitPrice: price, ...fired }] : [];
      });
    },

    async exited(position) {
      book.delete(position.id);
    },

    clear: book.clear,
  };
}
