/**
 * The expected move of the underlying by expiry, read from the ATM straddle's
 * price. Used by the Option Chain and Sell Strategy screens.
 */

import { OptionChainRow } from './optionChain';

/**
 * Calculate expected move from ATM straddle premium.
 * Expected move ≈ ATM CE price + ATM PE price
 */
export function calculateExpectedMove(
  chain: OptionChainRow[],
  atmStrike: number,
  livePrices: Map<number, number>,
): number {
  const atmRow = chain.find((r) => r.strike === atmStrike);
  if (!atmRow) return 0;

  const cePrice = atmRow.ce ? livePrices.get(atmRow.ce.instrumentToken) || 0 : 0;
  const pePrice = atmRow.pe ? livePrices.get(atmRow.pe.instrumentToken) || 0 : 0;

  return cePrice + pePrice;
}
