/**
 * The value sets of the market analysis, in one place: the option analysis
 * (shared/optionAnalysis, the Option Analyzer, trap analysis, OI flow and fair
 * value), OI History, and the stock setups. Shared by the server (the Option
 * Analyzer setups strategy, the stock scan) and the browser.
 *
 * Like shared/tradeEnums.js, each value is its member's name
 * (SetupPattern.WallDefense is 'WallDefense'), and that is the text stored in
 * the database and its JSON (algo_trades.setup, trade_setup_signals.status and
 * details, stock_setup_signals.setup_type, stock_candle_sync.scan_summary).
 * Where the text shown to the user differs from the name, the enum has a label
 * list beside it (SETUP_PATTERNS) and a label function (setupPatternLabel).
 *
 * Imports nothing, so any shared, server or browser module can use it.
 */

/**
 * A label function for an { id, label } list: the label of `id`, or `id`
 * itself when the list doesn't hold it.
 * @param {{ id: string, label: string }[]} list
 * @returns {(id: unknown) => string}
 */
const labelFrom = (list) => (id) => list.find((entry) => entry.id === id)?.label ?? String(id);

/** Which way a reading leans: bullish, bearish, neutral, or both at once (Conflict). */
export const Bias = Object.freeze({ Bullish: 'Bullish', Bearish: 'Bearish', Neutral: 'Neutral', Conflict: 'Conflict' });

/** @typedef {typeof Bias[keyof typeof Bias]} BiasId */

/** Which way OI or price trends over days (OI History). */
export const Trend = Object.freeze({ Upward: 'Upward', Downward: 'Downward', Sideways: 'Sideways', Neutral: 'Neutral', Unknown: 'Unknown' });

/** @typedef {typeof Trend[keyof typeof Trend]} TrendId */

/** Which way a value moved over the day: up, down or neither. */
export const MoveDirection = Object.freeze({ Up: 'Up', Down: 'Down', Neutral: 'Neutral' });

/** @typedef {typeof MoveDirection[keyof typeof MoveDirection]} MoveDirectionId */

/** How strong a bias or trend is. */
export const Strength = Object.freeze({ Strong: 'Strong', Moderate: 'Moderate', Mild: 'Mild', Mixed: 'Mixed', Flat: 'Flat', Unknown: 'Unknown' });

/** @typedef {typeof Strength[keyof typeof Strength]} StrengthId */

/** How sure a reading is: by volume (the OI signal strip) or by score (the Strategy card). */
export const Confidence = Object.freeze({ High: 'High', Medium: 'Medium', Low: 'Low' });

/** @typedef {typeof Confidence[keyof typeof Confidence]} ConfidenceId */

/** The OI + price signal at a strike (shared/optionAnalysis/oiLevels.js). */
export const OiSignal = Object.freeze({
  LongBuildup: 'LongBuildup',
  ShortBuildup: 'ShortBuildup',
  LongUnwinding: 'LongUnwinding',
  ShortCovering: 'ShortCovering',
  Neutral: 'Neutral',
});

/** @typedef {typeof OiSignal[keyof typeof OiSignal]} OiSignalId */

/** Every OI signal with its label. */
export const OI_SIGNALS = /** @type {{ id: OiSignalId, label: string }[]} */ ([
  { id: OiSignal.LongBuildup, label: 'Long Buildup' },
  { id: OiSignal.ShortBuildup, label: 'Short Buildup' },
  { id: OiSignal.LongUnwinding, label: 'Long Unwinding' },
  { id: OiSignal.ShortCovering, label: 'Short Covering' },
  { id: OiSignal.Neutral, label: 'Neutral' },
]);

/** An OI signal's label (Long Buildup …). */
export const oiSignalLabel = labelFrom(OI_SIGNALS);

/** The side of the price a level sits on: an OI wall, or a stock's support / resistance zone. */
export const LevelSide = Object.freeze({ Support: 'Support', Resistance: 'Resistance' });

/** @typedef {typeof LevelSide[keyof typeof LevelSide]} LevelSideId */

/** How an option's OI moved through the day (shared/optionAnalysis/velocityPattern.js). */
export const VelocityTrend = Object.freeze({
  AcceleratingBuildup: 'AcceleratingBuildup',
  SteadyBuildup: 'SteadyBuildup',
  SlowingBuildup: 'SlowingBuildup',
  Buildup: 'Buildup',
  MildBuildup: 'MildBuildup',
  AcceleratingUnwind: 'AcceleratingUnwind',
  SteadyUnwind: 'SteadyUnwind',
  SlowingUnwind: 'SlowingUnwind',
  Unwinding: 'Unwinding',
  MildUnwind: 'MildUnwind',
  Volatile: 'Volatile',
  Stable: 'Stable',
});

/** @typedef {typeof VelocityTrend[keyof typeof VelocityTrend]} VelocityTrendId */

/** Every velocity trend with its label. */
export const VELOCITY_TRENDS = /** @type {{ id: VelocityTrendId, label: string }[]} */ ([
  { id: VelocityTrend.AcceleratingBuildup, label: 'Accelerating Buildup' },
  { id: VelocityTrend.SteadyBuildup, label: 'Steady Buildup' },
  { id: VelocityTrend.SlowingBuildup, label: 'Slowing Buildup' },
  { id: VelocityTrend.Buildup, label: 'Buildup' },
  { id: VelocityTrend.MildBuildup, label: 'Mild Buildup' },
  { id: VelocityTrend.AcceleratingUnwind, label: 'Accelerating Unwind' },
  { id: VelocityTrend.SteadyUnwind, label: 'Steady Unwind' },
  { id: VelocityTrend.SlowingUnwind, label: 'Slowing Unwind' },
  { id: VelocityTrend.Unwinding, label: 'Unwinding' },
  { id: VelocityTrend.MildUnwind, label: 'Mild Unwind' },
  { id: VelocityTrend.Volatile, label: 'Volatile' },
  { id: VelocityTrend.Stable, label: 'Stable' },
]);

/** A velocity trend's label (Accelerating Buildup …). */
export const velocityTrendLabel = labelFrom(VELOCITY_TRENDS);

/** An option trade the Strategy card suggests: one leg, a straddle or a strangle, sold or bought. */
export const OptionSetup = Object.freeze({
  SellCe: 'SellCe',
  SellPe: 'SellPe',
  SellStraddle: 'SellStraddle',
  SellStrangle: 'SellStrangle',
  BuyCe: 'BuyCe',
  BuyPe: 'BuyPe',
  BuyStraddle: 'BuyStraddle',
  BuyStrangle: 'BuyStrangle',
});

/** @typedef {typeof OptionSetup[keyof typeof OptionSetup]} OptionSetupId */

/** Every option setup with its label. */
export const OPTION_SETUPS = /** @type {{ id: OptionSetupId, label: string }[]} */ ([
  { id: OptionSetup.SellCe, label: 'Sell CE' },
  { id: OptionSetup.SellPe, label: 'Sell PE' },
  { id: OptionSetup.SellStraddle, label: 'Straddle' },
  { id: OptionSetup.SellStrangle, label: 'Strangle' },
  { id: OptionSetup.BuyCe, label: 'Buy CE' },
  { id: OptionSetup.BuyPe, label: 'Buy PE' },
  { id: OptionSetup.BuyStraddle, label: 'Straddle' },
  { id: OptionSetup.BuyStrangle, label: 'Strangle' },
]);

/** An option setup's label (Sell CE, Straddle …). */
export const optionSetupLabel = labelFrom(OPTION_SETUPS);

/** The pattern that scored most in a suggested setup; stored with each automated trade (algo_trades.setup). */
export const SetupPattern = Object.freeze({
  Pinning: 'Pinning',
  WallDefense: 'WallDefense',
  VelocityConfirmed: 'VelocityConfirmed',
  PcrExtreme: 'PcrExtreme',
  ThetaDecay: 'ThetaDecay',
  Breakout: 'Breakout',
  DirectionalOi: 'DirectionalOi',
  Momentum: 'Momentum',
  PcrShift: 'PcrShift',
  RiskReward: 'RiskReward',
  Mixed: 'Mixed',
});

/** @typedef {typeof SetupPattern[keyof typeof SetupPattern]} SetupPatternId */

/** Every setup pattern with its label. */
export const SETUP_PATTERNS = /** @type {{ id: SetupPatternId, label: string }[]} */ ([
  { id: SetupPattern.Pinning, label: 'Pinning' },
  { id: SetupPattern.WallDefense, label: 'Wall Defense' },
  { id: SetupPattern.VelocityConfirmed, label: 'Velocity Confirmed' },
  { id: SetupPattern.PcrExtreme, label: 'PCR Extreme' },
  { id: SetupPattern.ThetaDecay, label: 'Theta Decay' },
  { id: SetupPattern.Breakout, label: 'Breakout' },
  { id: SetupPattern.DirectionalOi, label: 'Directional OI' },
  { id: SetupPattern.Momentum, label: 'Momentum' },
  { id: SetupPattern.PcrShift, label: 'PCR Shift' },
  { id: SetupPattern.RiskReward, label: 'Risk/Reward' },
  { id: SetupPattern.Mixed, label: 'Mixed' },
]);

/** A setup pattern's label (Wall Defense …). */
export const setupPatternLabel = labelFrom(SETUP_PATTERNS);

/** Whether a position at a strike looks trapped (trap analysis). */
export const TrapVerdict = Object.freeze({ Safe: 'Safe', Caution: 'Caution', LikelyTrapped: 'LikelyTrapped' });

/** @typedef {typeof TrapVerdict[keyof typeof TrapVerdict]} TrapVerdictId */

/** Every trap verdict with its label. */
export const TRAP_VERDICTS = /** @type {{ id: TrapVerdictId, label: string }[]} */ ([
  { id: TrapVerdict.Safe, label: 'Looks Safe' },
  { id: TrapVerdict.Caution, label: 'Caution' },
  { id: TrapVerdict.LikelyTrapped, label: 'Likely Trapped' },
]);

/** A trap verdict's label (Looks Safe, Caution, Likely Trapped). */
export const trapVerdictLabel = labelFrom(TRAP_VERDICTS);

/** An option's premium against the IV curve (fair value). */
export const Richness = Object.freeze({ Expensive: 'Expensive', Fair: 'Fair', Cheap: 'Cheap' });

/** @typedef {typeof Richness[keyof typeof Richness]} RichnessId */

/** Options overall against realised volatility (fair value). */
export const VolVerdict = Object.freeze({ OptionsExpensive: 'OptionsExpensive', FairlyPriced: 'FairlyPriced', OptionsCheap: 'OptionsCheap' });

/** @typedef {typeof VolVerdict[keyof typeof VolVerdict]} VolVerdictId */

/** Every volatility verdict with its label. */
export const VOL_VERDICTS = /** @type {{ id: VolVerdictId, label: string }[]} */ ([
  { id: VolVerdict.OptionsExpensive, label: 'Options expensive' },
  { id: VolVerdict.FairlyPriced, label: 'Fairly priced' },
  { id: VolVerdict.OptionsCheap, label: 'Options cheap' },
]);

/** A volatility verdict's label (Options expensive …). */
export const volVerdictLabel = labelFrom(VOL_VERDICTS);

/** Where a forward price came from: implied from CE / PE prices (Parity), or spot grown at the rate (Carry). */
export const ForwardSource = Object.freeze({ Parity: 'Parity', Carry: 'Carry' });

/** @typedef {typeof ForwardSource[keyof typeof ForwardSource]} ForwardSourceId */

/** The market stance a strike's CE and PE signals make together (the OI chart signal strip). */
export const CombinedStance = Object.freeze({
  StrongBullish: 'StrongBullish',
  Bullish: 'Bullish',
  BullishWeak: 'BullishWeak',
  StrongBearish: 'StrongBearish',
  Bearish: 'Bearish',
  BearishWeak: 'BearishWeak',
  Pinning: 'Pinning',
  HighVolatility: 'HighVolatility',
  Breakout: 'Breakout',
  DeRisking: 'DeRisking',
  Transitional: 'Transitional',
  FadingBull: 'FadingBull',
  FadingBear: 'FadingBear',
});

/** @typedef {typeof CombinedStance[keyof typeof CombinedStance]} CombinedStanceId */

/** Who moved an option's OI, read from OI and IV changes (the OI flow). */
export const OiFlow = Object.freeze({
  BuyersAdding: 'BuyersAdding',
  WritersAdding: 'WritersAdding',
  BuyersExiting: 'BuyersExiting',
  WritersCovering: 'WritersCovering',
  Unclear: 'Unclear',
  Stable: 'Stable',
  None: 'None',
});

/** @typedef {typeof OiFlow[keyof typeof OiFlow]} OiFlowId */

/** Every OI flow with its label. */
export const OI_FLOWS = /** @type {{ id: OiFlowId, label: string }[]} */ ([
  { id: OiFlow.BuyersAdding, label: 'Buyers Adding' },
  { id: OiFlow.WritersAdding, label: 'Writers Adding' },
  { id: OiFlow.BuyersExiting, label: 'Buyers Exiting' },
  { id: OiFlow.WritersCovering, label: 'Writers Covering' },
  { id: OiFlow.Unclear, label: 'Unclear' },
  { id: OiFlow.Stable, label: 'Stable' },
  { id: OiFlow.None, label: '-' },
]);

/** An OI flow's label (Buyers Adding …). */
export const oiFlowLabel = labelFrom(OI_FLOWS);

/** How an option's OI and price moved from one day to the next (OI History). */
export const RolloverPattern = Object.freeze({
  RollingOverLong: 'RollingOverLong',
  RollingOverShort: 'RollingOverShort',
  RollingOver: 'RollingOver',
  ExitingLongUnwind: 'ExitingLongUnwind',
  ExitingShortCover: 'ExitingShortCover',
  Exiting: 'Exiting',
  FreshBuildLong: 'FreshBuildLong',
  FreshBuildShort: 'FreshBuildShort',
  FreshBuild: 'FreshBuild',
  DoublingDownLong: 'DoublingDownLong',
  DoublingDownShort: 'DoublingDownShort',
  DoublingDown: 'DoublingDown',
  LongBuildup: 'LongBuildup',
  ShortBuildup: 'ShortBuildup',
  LongUnwinding: 'LongUnwinding',
  ShortCovering: 'ShortCovering',
  Unwinding: 'Unwinding',
  Stable: 'Stable',
  None: 'None',
});

/** @typedef {typeof RolloverPattern[keyof typeof RolloverPattern]} RolloverPatternId */

/** Every rollover pattern with its label. */
export const ROLLOVER_PATTERNS = /** @type {{ id: RolloverPatternId, label: string }[]} */ ([
  { id: RolloverPattern.RollingOverLong, label: 'Rolling Over (Long)' },
  { id: RolloverPattern.RollingOverShort, label: 'Rolling Over (Short)' },
  { id: RolloverPattern.RollingOver, label: 'Rolling Over' },
  { id: RolloverPattern.ExitingLongUnwind, label: 'Exiting (Long Unwind)' },
  { id: RolloverPattern.ExitingShortCover, label: 'Exiting (Short Cover)' },
  { id: RolloverPattern.Exiting, label: 'Exiting' },
  { id: RolloverPattern.FreshBuildLong, label: 'Fresh Build (Long)' },
  { id: RolloverPattern.FreshBuildShort, label: 'Fresh Build (Short)' },
  { id: RolloverPattern.FreshBuild, label: 'Fresh Build' },
  { id: RolloverPattern.DoublingDownLong, label: 'Doubling Down (Long)' },
  { id: RolloverPattern.DoublingDownShort, label: 'Doubling Down (Short)' },
  { id: RolloverPattern.DoublingDown, label: 'Doubling Down' },
  { id: RolloverPattern.LongBuildup, label: 'Long Buildup' },
  { id: RolloverPattern.ShortBuildup, label: 'Short Buildup' },
  { id: RolloverPattern.LongUnwinding, label: 'Long Unwinding' },
  { id: RolloverPattern.ShortCovering, label: 'Short Covering' },
  { id: RolloverPattern.Unwinding, label: 'Unwinding' },
  { id: RolloverPattern.Stable, label: 'Stable' },
  { id: RolloverPattern.None, label: '-' },
]);

/** A rollover pattern's label (Rolling Over (Long) …). */
export const rolloverPatternLabel = labelFrom(ROLLOVER_PATTERNS);

/** Where an OI History trade setup stands; stored with each logged signal (trade_setup_signals.status). */
export const TradeSetupStatus = Object.freeze({ Confirmed: 'Confirmed', Watch: 'Watch', Avoid: 'Avoid' });

/** @typedef {typeof TradeSetupStatus[keyof typeof TradeSetupStatus]} TradeSetupStatusId */

/**
 * Whether a value is a trade setup status.
 * @param {unknown} value
 * @returns {value is TradeSetupStatusId}
 */
export const isTradeSetupStatus = (value) => Object.values(TradeSetupStatus).some((status) => status === value);

/** The option selling setup OI History reads from the levels. */
export const SellingSetup = Object.freeze({ CallSell: 'CallSell', PutSell: 'PutSell', RangeSell: 'RangeSell', NoSell: 'NoSell' });

/** @typedef {typeof SellingSetup[keyof typeof SellingSetup]} SellingSetupId */

/** Every selling setup with its label. */
export const SELLING_SETUPS = /** @type {{ id: SellingSetupId, label: string }[]} */ ([
  { id: SellingSetup.CallSell, label: 'Call Sell' },
  { id: SellingSetup.PutSell, label: 'Put Sell' },
  { id: SellingSetup.RangeSell, label: 'Range Sell' },
  { id: SellingSetup.NoSell, label: 'No Sell' },
]);

/** A selling setup's label (Call Sell …). */
export const sellingSetupLabel = labelFrom(SELLING_SETUPS);

/** How a slice of the logged OI signals has done. */
export const SignalVerdict = Object.freeze({ Working: 'Working', Mixed: 'Mixed', Losing: 'Losing', TooFew: 'TooFew' });

/** @typedef {typeof SignalVerdict[keyof typeof SignalVerdict]} SignalVerdictId */

/** Every signal verdict with its label. */
export const SIGNAL_VERDICTS = /** @type {{ id: SignalVerdictId, label: string }[]} */ ([
  { id: SignalVerdict.Working, label: 'Working' },
  { id: SignalVerdict.Mixed, label: 'Mixed' },
  { id: SignalVerdict.Losing, label: 'Losing' },
  { id: SignalVerdict.TooFew, label: 'Too few' },
]);

/** A signal verdict's label (Too few …). */
export const signalVerdictLabel = labelFrom(SIGNAL_VERDICTS);

/** A stock setup the scan finds (shared/stockSetups.js); stored per signal (stock_setup_signals.setup_type). */
export const StockSetupType = Object.freeze({
  Pullback: 'Pullback',
  Reversal: 'Reversal',
  Breakout: 'Breakout',
  Rejection: 'Rejection',
  Breakdown: 'Breakdown',
});

/** @typedef {typeof StockSetupType[keyof typeof StockSetupType]} StockSetupTypeId */

/** Where a stock's price stands against its own recent moves (the stock scan). */
export const StockState = Object.freeze({ Falling: 'Falling', Stretched: 'Stretched', Turning: 'Turning', Uptrend: 'Uptrend', Sideways: 'Sideways' });

/** @typedef {typeof StockState[keyof typeof StockState]} StockStateId */

/** How a stock moved against the market reference index (the stock scan). */
export const MarketRelation = Object.freeze({ WithMarket: 'WithMarket', Alone: 'Alone', Stronger: 'Stronger', InLine: 'InLine' });

/** @typedef {typeof MarketRelation[keyof typeof MarketRelation]} MarketRelationId */

/** What made a price level count as support or resistance (the stock scan). */
export const LevelKind = Object.freeze({
  SwingLow: 'SwingLow',
  SwingHigh: 'SwingHigh',
  Volume: 'Volume',
  Sma50: 'Sma50',
  Sma200: 'Sma200',
  Round: 'Round',
});

/** @typedef {typeof LevelKind[keyof typeof LevelKind]} LevelKindId */

/**
 * What a token in an OI snapshot's `contracts` map is (oi_snapshots.contracts):
 * an option, by its Kite type (CE / PE), or the underlying's price (SPOT).
 * The stored text is exported for offline analysis, so it never changes.
 */
export const SnapshotContractType = Object.freeze({ CE: 'CE', PE: 'PE', SPOT: 'SPOT' });

/** @typedef {typeof SnapshotContractType[keyof typeof SnapshotContractType]} SnapshotContractTypeId */
