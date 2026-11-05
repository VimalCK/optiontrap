/**
 * Option chain shape and windowing, shared by the Option Analyzer (browser)
 * and the trade engine's Option Analyzer setups strategy (server), so both
 * look at the same strikes: the chain of one expiry, ATM as the strike
 * closest to spot, and the ±15 strikes around it that the analyzer shows.
 */

/**
 * The fields of an option the analysis reads; the browser's and the
 * server's instrument rows both have them.
 * @typedef {{ instrumentToken: number, strike: number, expiry: string | null, instrumentType: string }} ChainOption
 */

/**
 * One strike of a chain, with its call and put (either may be missing).
 * @template {ChainOption} [T=ChainOption]
 * @typedef {{ strike: number, ce: T | null, pe: T | null }} ChainRow
 */

/** Strikes shown either side of ATM in the analyzer. */
export const STRIKES_EACH_SIDE = 15;

/**
 * Expiries on or after `today` (YYYY-MM-DD, market date), soonest first.
 * @param {{ expiry: string | null }[]} options
 * @param {string} today
 * @returns {string[]}
 */
export function upcomingExpiries(options, today) {
  return /** @type {string[]} */ ([...new Set(options.map((o) => o.expiry))].filter((exp) => exp && exp.slice(0, 10) >= today)).sort();
}

/**
 * The chain rows of one expiry, by strike ascending.
 * @template {ChainOption} T
 * @param {T[]} options
 * @param {string} expiry
 * @returns {ChainRow<T>[]}
 */
export function buildOptionChain(options, expiry) {
  /** @type {Map<number, ChainRow<T>>} */
  const rows = new Map();
  for (const option of options) {
    if (option.expiry !== expiry) continue;
    if (!rows.has(option.strike)) rows.set(option.strike, { strike: option.strike, ce: null, pe: null });
    const row = /** @type {ChainRow<T>} */ (rows.get(option.strike));
    if (option.instrumentType === 'CE') row.ce = option;
    else row.pe = option;
  }
  return [...rows.values()].sort((a, b) => a.strike - b.strike);
}

/**
 * The ATM strike: the one closest to spot; the middle of the chain with no spot; 0 for an empty chain.
 * @param {{ strike: number }[]} chain
 * @param {number} spot
 */
export function atmStrikeOf(chain, spot) {
  if (chain.length === 0) return 0;
  if (spot <= 0) return chain[Math.floor(chain.length / 2)].strike;
  let closest = chain[0].strike;
  for (const row of chain) {
    if (Math.abs(row.strike - spot) < Math.abs(closest - spot)) closest = row.strike;
  }
  return closest;
}

/**
 * The strikes the analyzer shows: `each` either side of ATM. Near an edge of
 * the chain the window shifts rather than shrinks, so its size stays fixed.
 * @template {{ strike: number }} R
 * @param {R[]} chain
 * @param {number} atmStrike
 * @param {number} [each]
 * @returns {R[]}
 */
export function strikeWindow(chain, atmStrike, each = STRIKES_EACH_SIDE) {
  if (chain.length === 0) return [];
  const total = each * 2 + 1;
  const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
  let start = atmIndex - each;
  let end = atmIndex + each + 1;
  if (start < 0) { end = Math.min(chain.length, end - start); start = 0; }
  if (end > chain.length) { start = Math.max(0, start - (end - chain.length)); end = chain.length; }
  return chain.slice(start, Math.min(end, start + total));
}

/**
 * The average volume of the options in these rows that have traded; 0 with none.
 * @param {ChainRow[]} rows
 * @param {Map<number, number>} volumes  instrument token → volume
 */
export function averageVolume(rows, volumes) {
  if (volumes.size === 0) return 0;
  let total = 0;
  let count = 0;
  for (const row of rows) {
    for (const option of [row.ce, row.pe]) {
      const volume = option ? volumes.get(option.instrumentToken) : undefined;
      if (volume) { total += volume; count++; }
    }
  }
  return count > 0 ? total / count : 0;
}
