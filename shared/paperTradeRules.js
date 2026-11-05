/**
 * Paper trade rules: the single list of checks a paper trade must pass before
 * it is opened or exited.
 *
 * Everything that places or exits a paper trade goes through these: the
 * /api/positions routes (via server/paperTrading.js) today, and the trade
 * automation later. The browser can use them too, to check before asking.
 * To change what's allowed, change this list; don't add checks in callers.
 *
 * A rule is { id, appliesTo, code, check }:
 *   id         stable name, for logs and tests
 *   appliesTo  the actions it checks: 'open' and/or 'exit'
 *   code       error code reported when it fails (callers map it to HTTP etc.)
 *   check(ctx) returns null when the trade passes, or a message saying why not
 *
 * ctx for 'open': { trade, now }            trade from normalizeTradeInput
 * ctx for 'exit': { position, exitPrice, now }  position is the open position
 */
import { isMarketOpen } from './marketTime.js';

/**
 * @typedef {{ trade?: any, position?: any, exitPrice?: unknown, now?: Date }} RuleContext
 * @typedef {{ id: string, appliesTo: string[], code: string, check: (ctx: RuleContext) => string | null }} PaperTradeRule
 */

export const PAPER_TRADE_ACTIONS = ['open', 'exit'];

/** Error codes a rule can report. */
export const RULE_CODES = {
  INVALID_TRADE: 'INVALID_TRADE',
  MARKET_CLOSED: 'MARKET_CLOSED',
};

export const MARKET_CLOSED_MESSAGE =
  'The market is closed. Paper trades can be placed and exited 9:15–15:30 IST on trading days.';

/**
 * What a position is in: CE / PE (options), FUT (futures), EQ (stocks).
 * Options need a strike, CE/PE and an expiry; futures an expiry; stocks neither.
 */
export const INSTRUMENT_TYPES = ['CE', 'PE', 'FUT', 'EQ'];
const OPTION_TYPES = ['CE', 'PE'];

/** Exchange a trade defaults to when none is given: options and futures NFO, stocks NSE. */
const defaultExchange = (/** @type {unknown} */ instrumentType) => (instrumentType === 'EQ' ? 'NSE' : 'NFO');

/** Positions without a mode are paper trades. */
const isPaper = (/** @type {unknown} */ mode) => (mode ?? 'paper') === 'paper';

/**
 * A trade request with its numbers parsed, as the rules and the database
 * expect it. Missing values stay missing (null/undefined/NaN) so the rules
 * can report them; nothing is filled in except mode, which defaults to paper.
 * @param {Record<string, unknown>} input
 */
export function normalizeTradeInput(input = /** @type {Record<string, any>} */ ({})) {
  const num = (/** @type {unknown} */ value) => (value === undefined || value === null || value === '' ? value : Number(value));
  // Callers from before stocks and futures send only optionType: CE/PE is an option.
  const instrumentType = input.instrumentType ?? (OPTION_TYPES.includes(/** @type {string} */ (input.optionType)) ? input.optionType : undefined);
  return {
    tradingsymbol: input.tradingsymbol,
    instrumentToken: num(input.instrumentToken),
    instrumentType,
    exchange: input.exchange || defaultExchange(instrumentType),
    strike: num(input.strike),
    optionType: input.optionType,
    side: input.side,
    quantity: num(input.quantity),
    entryPrice: num(input.entryPrice),
    expiry: input.expiry,
    mode: input.mode || 'paper',
    note: input.note,
    targetPrice: input.targetPrice,
    stopLossPrice: input.stopLossPrice,
    strategyTag: input.strategyTag,
    confidence: input.confidence,
  };
}

/** @type {PaperTradeRule[]} */
export const PAPER_TRADE_RULES = [
  {
    id: 'required-fields',
    appliesTo: ['open'],
    code: RULE_CODES.INVALID_TRADE,
    check: ({ trade }) => {
      const { tradingsymbol, instrumentToken, side, quantity, entryPrice } = trade;
      const complete = tradingsymbol && instrumentToken && side && quantity && entryPrice;
      return complete ? null : 'Missing required fields';
    },
  },
  {
    // Each instrument type carries exactly the fields it has.
    id: 'instrument-fields',
    appliesTo: ['open'],
    code: RULE_CODES.INVALID_TRADE,
    check: ({ trade }) => {
      const { instrumentType, strike, optionType, expiry } = trade;
      if (!INSTRUMENT_TYPES.includes(instrumentType)) return `instrumentType must be one of: ${INSTRUMENT_TYPES.join(', ')}`;
      if (OPTION_TYPES.includes(instrumentType)) {
        if (strike == null || Number.isNaN(strike) || !expiry) return 'An option needs a strike and an expiry';
        if (optionType !== instrumentType) return 'optionType must match instrumentType for an option';
      }
      if (instrumentType === 'FUT' && !expiry) return 'A future needs an expiry';
      return null;
    },
  },
  {
    id: 'exit-price-given',
    appliesTo: ['exit'],
    code: RULE_CODES.INVALID_TRADE,
    check: ({ exitPrice }) => (exitPrice == null ? 'exitPrice is required' : null),
  },
  {
    // Paper trades fill at the last traded price, which is stale while the
    // market is closed (that's how trades ended up dated on a Saturday).
    // Live trades go through Kite and aren't limited here.
    id: 'market-open',
    appliesTo: ['open', 'exit'],
    code: RULE_CODES.MARKET_CLOSED,
    check: ({ trade, position, now = new Date() }) => {
      const mode = (trade ?? position)?.mode;
      if (!isPaper(mode)) return null;
      return isMarketOpen(now) ? null : MARKET_CLOSED_MESSAGE;
    },
  },
];

/**
 * Run every rule for `action`, in list order.
 * @param {'open' | 'exit'} action
 * @param {RuleContext} ctx see the file header
 * @param {PaperTradeRule[]} [rules] defaults to PAPER_TRADE_RULES
 * @returns {{ ok: true } | { ok: false, violations: { rule: string, code: string, message: string }[] }}
 */
export function checkPaperTrade(action, ctx, rules = PAPER_TRADE_RULES) {
  if (!PAPER_TRADE_ACTIONS.includes(action)) throw new Error(`Unknown paper trade action: ${action}`);
  const violations = [];
  for (const rule of rules) {
    if (!rule.appliesTo.includes(action)) continue;
    const message = rule.check(ctx);
    if (message) violations.push({ rule: rule.id, code: rule.code, message });
  }
  return violations.length ? { ok: false, violations } : { ok: true };
}
