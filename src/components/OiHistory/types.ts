import type { BiasId, RichnessId, RolloverPatternId, SellingSetupId, SignalVerdictId, StrengthId, TradeSetupStatusId } from '../../../shared/analysisEnums.js';
import type { Bias, Strength, Trend } from '../../../shared/analysisEnums.js';
import { type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { type HealthStatusId } from '../../../shared/appEnums.js';

export interface OiHistoryRow {
  date: string;
  instrumentToken: number;
  tradingsymbol: string;
  strike: number | null;
  optionType: string | null;
  expiry: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  spotClose: number;
}

export interface FuturesHistoryRow {
  date: string;
  instrumentToken: number;
  tradingsymbol: string;
  expiry: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

export interface FetchProgress {
  step: string;
  pct: number;
  detail: string;
}

export interface SignalPerformanceSummary {
  total: number;
  open: number;
  averageOpenReturn: number | null;
  evaluated: number;
  wins: number;
  winRate: number | null;
  averageReturn: number | null;
  averageMaxFavorable: number | null;
  averageMaxAdverse: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  sellEvaluated: number;
  sellWinRate: number | null;
  buyEvaluated: number;
  buyWinRate: number | null;
}

/** Which way a strike's option flow leans over the history. */
export type StrikeBias = typeof Trend.Upward | typeof Trend.Downward | typeof Trend.Neutral;

/** Which way one day's option flow leaned. */
export type DailyBias = typeof Bias.Bullish | typeof Bias.Bearish | typeof Bias.Neutral;

/** Which way the underlying moved over the history. */
export type PriceTrendDirection = typeof Trend.Upward | typeof Trend.Downward | typeof Trend.Sideways | typeof Trend.Unknown;

export interface StrikeBiasDay {
  date: string;
  cePattern: RolloverPatternId;
  pePattern: RolloverPatternId;
  bias: DailyBias;
  score: number;
  cumulativeScore: number;
}

export interface StrikeBiasSummary {
  bias: StrikeBias;
  strength: typeof Strength.Strong | typeof Strength.Moderate | typeof Strength.Mild | typeof Strength.Mixed;
  confidence: number;
  score: number;
  bullishDays: number;
  bearishDays: number;
  neutralDays: number;
  totalDays: number;
  ceOiChangePct: number | null;
  peOiChangePct: number | null;
  pcrStart: number | null;
  pcrEnd: number | null;
  spotChangePct: number | null;
  recentBias: DailyBias;
  recentScore: number;
  recentDays: StrikeBiasDay[];
  driver: string;
  warning: string | null;
  reason: string;
}

export interface PriceTrendSummary {
  direction: PriceTrendDirection;
  strength: Exclude<StrengthId, typeof Strength.Mixed>;
  startPrice: number | null;
  endPrice: number | null;
  changePct: number | null;
  recentChangePct: number | null;
  sessions: number;
  reason: string;
}

export interface TradeBiasSummary {
  bias: BiasId;
  title: string;
  action: string;
  reason: string;
}

export type ChecklistStatus = HealthStatusId;

export interface TradeSetupChecklistItem {
  label: string;
  status: ChecklistStatus;
  answer: string;
}

export interface TradeLevelRow {
  strike: number;
  ceConsolidatedOi: number;
  peConsolidatedOi: number;
}

export interface TradeLevelContext {
  spot: number | null;
  supportStrike: number | null;
  resistanceStrike: number | null;
  maxOiStrike: number | null;
  selectedDistancePct: number | null;
  locationStatus: ChecklistStatus;
  riskRewardStatus: ChecklistStatus;
  locationAnswer: string;
  riskRewardAnswer: string;
}

export interface TradeSetupSummary {
  status: TradeSetupStatusId;
  direction: DailyBias;
  title: string;
  action: string;
  strategy: string;
  trigger: string;
  invalidation: string;
  target: string;
  sizing: string;
  checklist: TradeSetupChecklistItem[];
}

export interface SellingSetupSummary {
  status: TradeSetupStatusId;
  type: SellingSetupId;
  title: string;
  action: string;
  trigger: string;
  invalidation: string;
  target: string;
  sizing: string;
  checklist: TradeSetupChecklistItem[];
}

export interface StrikeHistoryEntry {
  ceOi: number;
  peOi: number;
  ceClose: number;
  peClose: number;
  ceVolume: number;
  peVolume: number;
  /** Fair value at the IV curve, filled only while the chart's fair-value view is on. */
  ceFair?: number | null;
  peFair?: number | null;
  /** (close − fair) ÷ fair. */
  ceRichPct?: number | null;
  peRichPct?: number | null;
  ceFairLabel?: RichnessId | null;
  peFairLabel?: RichnessId | null;
}

export interface PremiumDecaySide {
  optionType: OptionTypeId;
  firstClose: number;
  latestClose: number;
  decayPct: number;
  recentDecayPct: number | null;
  latestOi: number;
  oiChangePct: number | null;
  latestVolume: number;
  averageVolume: number;
  daysToExpiry: number | null;
  score: number;
  reason: string;
}

export interface PremiumDecaySummary {
  nearestExpiry: string | null;
  ce: PremiumDecaySide | null;
  pe: PremiumDecaySide | null;
}

export interface OptionMomentumSide {
  optionType: OptionTypeId;
  firstClose: number;
  latestClose: number;
  momentumPct: number;
  recentMomentumPct: number | null;
  oiChangePct: number | null;
  latestVolume: number;
  averageVolume: number;
  daysToExpiry: number | null;
  score: number;
  reason: string;
}

export interface OptionMomentumSummary {
  nearestExpiry: string | null;
  ce: OptionMomentumSide | null;
  pe: OptionMomentumSide | null;
}

/** One strike × expiry cell of the OI Snapshot table. */
export interface OiCellData {
  ceOi: number;
  peOi: number;
  cePrevOi: number | undefined;
  pePrevOi: number | undefined;
  ceClose: number;
  peClose: number;
  cePrevClose: number | undefined;
  pePrevClose: number | undefined;
  ceToken: number | undefined;
  peToken: number | undefined;
  ceTradingsymbol: string | undefined;
  peTradingsymbol: string | undefined;
  ceExpiry: string | undefined;
  peExpiry: string | undefined;
}

/** One strike row of the OI Snapshot table. */
export interface OiTableRow {
  strike: number;
  cells: Map<string, OiCellData>;
  cePattern: RolloverPatternId;
  pePattern: RolloverPatternId;
  ceConsolidatedOi: number;
  peConsolidatedOi: number;
  dimmed: boolean;
}

/** Setup summaries for the selected strike, shown on the Trade Setup tab. */
export interface TradeSetupData {
  tradeSetup: TradeSetupSummary;
  sellingSetup: SellingSetupSummary;
  optionMomentum: OptionMomentumSummary;
  premiumDecay: PremiumDecaySummary;
  priceTrend: PriceTrendSummary;
  biasSummary: StrikeBiasSummary;
  tradeLevels: TradeLevelContext;
  tradeBias: TradeBiasSummary;
}

/** A logged trade setup signal and its scored outcome, as returned by /api/oi-history/signals. */
export interface TradeSignalRow {
  id: number;
  signal_date: string;
  expiry: string | null;
  strike: number;
  option_type: OptionTypeId;
  action: SideId;
  /** Setup strength when logged: Confirmed or Watch. */
  status: string;
  details: TradeSignalDetails | null;
  entry_premium: number | null;
  outcome_price: number | null;
  outcome_date: string | null;
  outcome_status: string | null;
  outcome_return: number | null;
  max_favorable_return: number | null;
  max_adverse_return: number | null;
  outcome_final: boolean | null;
}

/** Context saved with a signal when it was logged. Older signals lack the newer fields. */
export interface TradeSignalDetails {
  priceTrend?: { direction?: string } | null;
  decay?: { daysToExpiry?: number | null } | null;
  /** Option-flow bias at the strike (Upward / Downward / Neutral). */
  flowBias?: string;
  /** OI pattern of the traded option at the strike on the signal date. */
  strikePattern?: string;
  /** IV-based flow label of the traded contract on the signal date (see services/oiFlow). */
  ivFlow?: string;
  /** Rich / Fair / Cheap against the IV curve on the signal date (see services/fairValue). */
  fairValue?: string;
  /** Premium vs fair value, in %. */
  fairRichPct?: number | null;
}

/** Outcome stats for one slice of the logged signals, e.g. "Setup: SELL CE". */
export interface SignalBreakdownRow {
  group: string;
  label: string;
  total: number;
  scored: number;
  winRate: number | null;
  averageReturn: number | null;
  averageMaxAdverse: number | null;
  verdict: SignalVerdictId;
}
