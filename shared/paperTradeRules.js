/**
 * Paper trade rules: the one list of checks a paper trade must pass before it
 * is opened, exited or ordered. Every order (manual or automated) and every
 * exit goes through them, on the server and in the browser.
 *
 * A rule is { id, appliesTo, code, check }:
 *   id         stable name, for logs and tests
 *   appliesTo  the actions it checks (PaperTradeAction, shared/tradeEnums.js)
 *   code       error code reported when it fails (callers map it to HTTP etc.)
 *   check(ctx) returns null when the trade passes, or a message saying why not
 *
 * ctx for Open: { trade, now }            trade from normalizeTradeInput
 * ctx for Place: { trade, now }           an order's trade (shared/paperOrders.js)
 * ctx for Exit: { position, exitPrice, now }  position is the open position
 * ctx for SquareOff: { position, exitPrice, now }  the engine closing an intraday position after its
 *   session ended, at its last price after the close (server/tradeEngine/services/sessionSquareOff.js)
 */
import { isMarketOpen } from './marketTime.js';
import { HORIZONS, Horizon, INSTRUMENT_TYPES, InstrumentType, PaperTradeAction, TradingMode, exchangeFor, isHorizon, isOptionType } from './tradeEnums.js';

/**
 * @typedef {{ trade?: any, position?: any, exitPrice?: unknown, now?: Date }} RuleContext
 * @typedef {{ id: string, appliesTo: string[], code: string, check: (ctx: RuleContext) => string | null }} PaperTradeRule
 */

/**
 * open: a trade fills now; exit: a position closes now; place: an order is placed, to fill later or now;
 * square-off: the engine closes a position its session left open, after the close, at the closing price.
 */
const PAPER_TRADE_ACTIONS = Object.values(PaperTradeAction);

export const RULE_CODES = {
  INVALID_TRADE: 'INVALID_TRADE',
  MARKET_CLOSED: 'MARKET_CLOSED',
};

export const MARKET_CLOSED_MESSAGE =
  'The market is closed. Paper trades can be placed and exited 9:15–15:30 IST on trading days.';
export const INTRADAY_CLOSED_MESSAGE =
  'The market is closed. Intraday orders can be placed 9:15–15:30 IST on trading days; positional orders at any time.';

/**
 * What a position is in: CE / PE (options), FUT (futures), EQ (stocks).
 * Options need a strike, CE/PE and an expiry; futures an expiry; stocks neither.
 */

/** Positions without a mode are paper trades. */
const isPaper = (/** @type {unknown} */ mode) => (mode ?? TradingMode.Paper) === TradingMode.Paper;

/**
 * A trade request with its numbers parsed, as the rules and the database
 * expect it. Missing values stay missing (null/undefined/NaN) so the rules
 * can report them; nothing is filled in except mode, which defaults to paper.
 * @param {Record<string, unknown>} input
 */
export function normalizeTradeInput(input = /** @type {Record<string, any>} */ ({})) {
  const num = (/** @type {unknown} */ value) => (value === undefined || value === null || value === '' ? value : Number(value));
  // Callers from before stocks and futures send only optionType: CE/PE is an option.
  const instrumentType = input.instrumentType ?? (isOptionType(input.optionType) ? input.optionType : undefined);
  return {
    tradingsymbol: input.tradingsymbol,
    instrumentToken: num(input.instrumentToken),
    instrumentType,
    exchange: input.exchange || exchangeFor(instrumentType),
    strike: num(input.strike),
    optionType: input.optionType,
    side: input.side,
    quantity: num(input.quantity),
    entryPrice: num(input.entryPrice),
    expiry: input.expiry,
    mode: input.mode || TradingMode.Paper,
    horizon: input.horizon,
    note: input.note,
    targetPrice: input.targetPrice,
    stopLossPrice: input.stopLossPrice,
    confidence: input.confidence,
  };
}

/** @type {PaperTradeRule[]} */
export const PAPER_TRADE_RULES = [
  {
    id: 'required-fields',
    appliesTo: [PaperTradeAction.Open, PaperTradeAction.Place],
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
    appliesTo: [PaperTradeAction.Open, PaperTradeAction.Place],
    code: RULE_CODES.INVALID_TRADE,
    check: ({ trade }) => {
      const { instrumentType, strike, optionType, expiry } = trade;
      if (!INSTRUMENT_TYPES.some((type) => type === instrumentType)) return `instrumentType must be one of: ${INSTRUMENT_TYPES.join(', ')}`;
      if (isOptionType(instrumentType)) {
        if (strike == null || Number.isNaN(strike) || !expiry) return 'An option needs a strike and an expiry';
        if (optionType !== instrumentType) return 'optionType must match instrumentType for an option';
      }
      if (instrumentType === InstrumentType.FUT && !expiry) return 'A future needs an expiry';
      return null;
    },
  },
  {
    // Intraday or positional: the trade monitor squares off only intraday
    // positions, and trades merge only within the same horizon.
    id: 'horizon-given',
    appliesTo: [PaperTradeAction.Open, PaperTradeAction.Place],
    code: RULE_CODES.INVALID_TRADE,
    check: ({ trade }) => (isHorizon(trade.horizon) ? null : `Choose ${HORIZONS.map((h) => h.label).join(' or ')}`),
  },
  {
    id: 'exit-price-given',
    appliesTo: [PaperTradeAction.Exit, PaperTradeAction.SquareOff],
    code: RULE_CODES.INVALID_TRADE,
    check: ({ exitPrice }) => (exitPrice == null ? 'exitPrice is required' : null),
  },
  {
    // Paper trades fill at the last traded price, which is stale while the
    // market is closed (that's how trades ended up dated on a Saturday).
    // Live trades go through Kite and aren't limited here. A square-off isn't
    // covered: it is priced at the closing price on purpose, after the close.
    id: 'market-open',
    appliesTo: [PaperTradeAction.Open, PaperTradeAction.Exit],
    code: RULE_CODES.MARKET_CLOSED,
    check: ({ trade, position, now = new Date() }) => {
      const mode = (trade ?? position)?.mode;
      if (!isPaper(mode)) return null;
      return isMarketOpen(now) ? null : MARKET_CLOSED_MESSAGE;
    },
  },
  {
    // An intraday order is placed only while the market is open. A positional
    // one can be placed at any time: it waits, and the order book fills it in
    // market hours (a fill is an Open, checked by market-open above).
    id: 'intraday-market-hours',
    appliesTo: [PaperTradeAction.Place],
    code: RULE_CODES.MARKET_CLOSED,
    check: ({ trade, now = new Date() }) => {
      if (!isPaper(trade?.mode) || trade?.horizon !== Horizon.Intraday) return null;
      return isMarketOpen(now) ? null : INTRADAY_CLOSED_MESSAGE;
    },
  },
];

/**
 * @param {import('./tradeEnums.js').PaperTradeActionId} action
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
