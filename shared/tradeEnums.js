/**
 * The trading vocabulary as enums, like C#'s `enum Side { Buy, Sell }`: code
 * names a value by its member (`Side.BUY`, `OrderStatus.Open`), never by a raw
 * string, and each enum has its list and helpers beside it, so a set of values
 * is written down once.
 *
 * Members hold the text the database stores and the API sends: Side,
 * InstrumentType, OptionType and Exchange are Kite's own codes (quotes, orders
 * and the instrument list use them), and the rest (Horizon included, which
 * the automation config also keys its switches by) are text columns with a
 * CHECK in server/migrations. Each value is its member's name (OrderStatus.Open is
 * 'Open'), so code, database and API all read the same. SQL names a value through
 * sqlEnum (server/sql.js): `WHERE status = ${sqlEnum(OrderStatus.Open)}`, which
 * Postgres receives as a literal, so partial indexes on it are used.
 *
 * Imports nothing, so any shared, server or browser module can use it
 * without an import cycle.
 */

/** A trade's direction (Kite's transaction_type). */
export const Side = Object.freeze({ BUY: 'BUY', SELL: 'SELL' });

/** @typedef {typeof Side[keyof typeof Side]} SideId */

/** Both sides, in display order, with their labels. */
export const SIDES = /** @type {{ id: SideId, label: string }[]} */ ([
  { id: Side.BUY, label: 'Buy' },
  { id: Side.SELL, label: 'Sell' },
]);

/**
 * Whether `value` is a side.
 * @param {unknown} value
 * @returns {value is SideId}
 */
export const isSide = (value) => SIDES.some((side) => side.id === value);

/** A side's label (Buy, Sell), or the value itself when unknown. */
export const sideLabel = (/** @type {unknown} */ side) => SIDES.find((s) => s.id === side)?.label ?? String(side);

/** The side that closes a trade of `side`. */
export const oppositeSide = (/** @type {SideId} */ side) => (side === Side.BUY ? Side.SELL : Side.BUY);

/** What an instrument is (Kite's instrument_type): a call, a put, a future or a stock. */
export const InstrumentType = Object.freeze({ CE: 'CE', PE: 'PE', FUT: 'FUT', EQ: 'EQ' });

/** @typedef {typeof InstrumentType[keyof typeof InstrumentType]} InstrumentTypeId */

export const INSTRUMENT_TYPES = /** @type {InstrumentTypeId[]} */ (Object.values(InstrumentType));

export const OptionType = Object.freeze({ CE: InstrumentType.CE, PE: InstrumentType.PE });

/** @typedef {typeof OptionType[keyof typeof OptionType]} OptionTypeId */

export const OPTION_TYPES = /** @type {OptionTypeId[]} */ (Object.values(OptionType));

/**
 * Whether `value` is an option type (CE or PE).
 * @param {unknown} value
 * @returns {value is OptionTypeId}
 */
export const isOptionType = (value) => OPTION_TYPES.some((type) => type === value);

/** The exchanges instruments trade on (Kite's exchange codes). */
export const Exchange = Object.freeze({ NSE: 'NSE', BSE: 'BSE', NFO: 'NFO', BFO: 'BFO' });

/** @typedef {typeof Exchange[keyof typeof Exchange]} ExchangeId */

/**
 * Kite's `error_type` on an error reply (Kite's own codes): TokenException for
 * an expired or revoked login, PermissionException for a call this Kite app
 * isn't allowed to make (shared/kiteAuth.js tells them apart).
 */
export const KiteErrorType = Object.freeze({ TokenException: 'TokenException', PermissionException: 'PermissionException' });

/** @typedef {typeof KiteErrorType[keyof typeof KiteErrorType]} KiteErrorTypeId */

/** Where a paper trade of `instrumentType` trades: a stock on NSE, a derivative on NFO. */
export const exchangeFor = (/** @type {unknown} */ instrumentType) => (instrumentType === InstrumentType.EQ ? Exchange.NSE : Exchange.NFO);

/** Where a paper order stands. */
export const OrderStatus = Object.freeze({ Open: 'Open', Filled: 'Filled', Cancelled: 'Cancelled' });

/** @typedef {typeof OrderStatus[keyof typeof OrderStatus]} OrderStatusId */

/** How an order is priced: at a limit, or at the market (the bid / ask). */
export const OrderType = Object.freeze({ Limit: 'Limit', Market: 'Market' });

/** @typedef {typeof OrderType[keyof typeof OrderType]} OrderTypeId */

export const ORDER_TYPES = /** @type {OrderTypeId[]} */ (Object.values(OrderType));

/** Who placed a trade: the user by hand, or the trade automation. Set by the server, never read from input. */
export const TradeSource = Object.freeze({ Manual: 'Manual', Auto: 'Auto' });

/** @typedef {typeof TradeSource[keyof typeof TradeSource]} TradeSourceId */

/** Paper (simulated) or live (real Kite orders) trading. */
export const TradingMode = Object.freeze({ Paper: 'Paper', Live: 'Live' });

/** @typedef {typeof TradingMode[keyof typeof TradingMode]} TradingModeId */

export const TRADING_MODES = /** @type {TradingModeId[]} */ (Object.values(TradingMode));

/**
 * Whether `value` is a trading mode.
 * @param {unknown} value
 * @returns {value is TradingModeId}
 */
export const isTradingMode = (value) => TRADING_MODES.some((mode) => mode === value);

/** The Trade Journal's segments: options, futures and stocks. */
export const Segment = Object.freeze({ Options: 'Options', Futures: 'Futures', Stocks: 'Stocks' });

/** @typedef {typeof Segment[keyof typeof Segment]} SegmentId */

export const SEGMENTS = /** @type {SegmentId[]} */ (Object.values(Segment));

export function segmentOf(/** @type {unknown} */ instrumentType) {
  if (isOptionType(instrumentType)) return Segment.Options;
  return instrumentType === InstrumentType.FUT ? Segment.Futures : Segment.Stocks;
}

/** An automated trade's lifecycle stages (the moves between them: shared/automation.js). */
export const LifecycleStage = Object.freeze({
  Selected: 'Selected',
  Validated: 'Validated',
  Rejected: 'Rejected',
  Executed: 'Executed',
  Closed: 'Closed',
});

/** @typedef {typeof LifecycleStage[keyof typeof LifecycleStage]} LifecycleStageId */

/** Where a position list stands: GET /api/positions?status=Closed lists exited ones (no status: open plus today's exits). */
export const PositionStatus = Object.freeze({ Closed: 'Closed' });

/** @typedef {typeof PositionStatus[keyof typeof PositionStatus]} PositionStatusId */

/**
 * What a trade rule checks (shared/tradeRules.js): a trade filling now
 * (Open), a position closing now (Exit), an order being placed (Place), or the
 * engine closing a position its session left open, after the close (SquareOff).
 */
export const TradeAction = Object.freeze({ Open: 'Open', Exit: 'Exit', Place: 'Place', SquareOff: 'SquareOff' });

/** @typedef {typeof TradeAction[keyof typeof TradeAction]} TradeActionId */

/** The market session by IST time (shared/marketTime.js): pre-open, live, post-close (30 min after the close) or closed. */
export const MarketStatus = Object.freeze({ PreOpen: 'PreOpen', Live: 'Live', PostClose: 'PostClose', Closed: 'Closed' });

/** @typedef {typeof MarketStatus[keyof typeof MarketStatus]} MarketStatusId */

/** The trade engine's market events (server/tradeEngine/market.js): the session opens, or closes. */
export const MarketEvent = Object.freeze({ Open: 'Open', Close: 'Close' });

/** @typedef {typeof MarketEvent[keyof typeof MarketEvent]} MarketEventId */

/** What an automated trade trades (shared/automation.js lists them with labels): stocks, stock or index options and futures. */
export const TradeKind = Object.freeze({
  Stock: 'Stock',
  StockOption: 'StockOption',
  StockFuture: 'StockFuture',
  IndexOption: 'IndexOption',
  IndexFuture: 'IndexFuture',
});

/** @typedef {typeof TradeKind[keyof typeof TradeKind]} TradeKindId */

/**
 * Whether a trade is intraday (closed the same day) or positional (held over
 * days). Every paper position, limit order and automated trade carries one
 * (`horizon` on positions, orders and algo_trades), so the session square-off
 * knows which positions to close (shared/exitRules/squareOff.js) and trades
 * merge only with a position of the same horizon (server/db.js).
 */
export const Horizon = Object.freeze({ Intraday: 'Intraday', Positional: 'Positional' });

/** @typedef {typeof Horizon[keyof typeof Horizon]} HorizonId */

/**
 * Every horizon, in display order, with its label. `available` says whether
 * the trade automation can take trades on it yet (positional trades will
 * follow OI history and are not built); a manual trade can use either.
 * @type {{ id: HorizonId, label: string, available: boolean }[]}
 */
export const HORIZONS = [
  { id: Horizon.Intraday, label: 'Intraday', available: true },
  { id: Horizon.Positional, label: 'Positional', available: false },
];

/**
 * Whether `value` is a horizon.
 * @param {unknown} value
 * @returns {value is HorizonId}
 */
export const isHorizon = (value) => HORIZONS.some((h) => h.id === value);

/** A horizon's label (Intraday, Positional), or the value itself when unknown. */
export const horizonLabel = (/** @type {unknown} */ horizon) => HORIZONS.find((h) => h.id === horizon)?.label ?? String(horizon);

/** Which Zerodha charge schedule a trade pays (shared/tradeCharges.js): options, futures, or stocks held intraday or overnight. */
export const ChargeSegment = Object.freeze({ Option: 'Option', Future: 'Future', EquityIntraday: 'EquityIntraday', EquityDelivery: 'EquityDelivery' });

/** @typedef {typeof ChargeSegment[keyof typeof ChargeSegment]} ChargeSegmentId */

/** The kinds of value an entry or exit rule's setting can be (shared/rules/paramTypes.js). */
export const ParamType = Object.freeze({ Count: 'Count', Amount: 'Amount', Percent: 'Percent', Time: 'Time' });

/** @typedef {typeof ParamType[keyof typeof ParamType]} ParamTypeId */

/**
 * How much a Kite ticker subscription streams per token, in Kite's own words
 * (its WebSocket "mode" message): the last price, a quote, or the full depth.
 */
export const TickerMode = Object.freeze({ ltp: 'ltp', quote: 'quote', full: 'full' });

/** @typedef {typeof TickerMode[keyof typeof TickerMode]} TickerModeId */

/**
 * What a row of the automation results query groups by (server/winLossResults.js):
 * one GROUPING SETS column, or All for the summary row.
 */
export const ResultDimension = Object.freeze({
  Strategy: 'Strategy',
  Setup: 'Setup',
  ExitRule: 'ExitRule',
  EntrySlot: 'EntrySlot',
  Side: 'Side',
  Day: 'Day',
  All: 'All',
});

/** @typedef {typeof ResultDimension[keyof typeof ResultDimension]} ResultDimensionId */

/** How a Kite holding is held as collateral, in Kite's own words (holdings' collateral_type). */
export const CollateralType = Object.freeze({ pledge: 'pledge' });

/** @typedef {typeof CollateralType[keyof typeof CollateralType]} CollateralTypeId */
