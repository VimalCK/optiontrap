import type { Richness } from '@/services/fairValue';

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

export type RolloverPattern =
  | 'Rolling Over (Long)'
  | 'Rolling Over (Short)'
  | 'Rolling Over'
  | 'Exiting (Long Unwind)'
  | 'Exiting (Short Cover)'
  | 'Exiting'
  | 'Fresh Build (Long)'
  | 'Fresh Build (Short)'
  | 'Fresh Build'
  | 'Doubling Down (Long)'
  | 'Doubling Down (Short)'
  | 'Doubling Down'
  | 'Long Buildup'
  | 'Short Buildup'
  | 'Long Unwinding'
  | 'Short Covering'
  | 'Unwinding'
  | 'Stable'
  | '-';

export type StrikeBias = 'Upward' | 'Downward' | 'Neutral';

export type DailyBias = 'Bullish' | 'Bearish' | 'Neutral';

export type PriceTrendDirection = 'Upward' | 'Downward' | 'Sideways' | 'Unknown';

export type TradeBias = 'Bullish' | 'Bearish' | 'Conflict' | 'Neutral';

export interface StrikeBiasDay {
  date: string;
  cePattern: RolloverPattern;
  pePattern: RolloverPattern;
  bias: DailyBias;
  score: number;
  cumulativeScore: number;
}

export interface StrikeBiasSummary {
  bias: StrikeBias;
  strength: 'Strong' | 'Moderate' | 'Mild' | 'Mixed';
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
  strength: 'Strong' | 'Moderate' | 'Mild' | 'Flat' | 'Unknown';
  startPrice: number | null;
  endPrice: number | null;
  changePct: number | null;
  recentChangePct: number | null;
  sessions: number;
  reason: string;
}

export interface TradeBiasSummary {
  bias: TradeBias;
  title: string;
  action: string;
  reason: string;
}

export type TradeSetupStatus = 'Confirmed' | 'Watch' | 'Avoid';

export type ChecklistStatus = 'pass' | 'warn' | 'fail';

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
  status: TradeSetupStatus;
  direction: 'Bullish' | 'Bearish' | 'Neutral';
  title: string;
  action: string;
  strategy: string;
  trigger: string;
  invalidation: string;
  target: string;
  sizing: string;
  checklist: TradeSetupChecklistItem[];
}

export type SellingSetupType = 'Call Sell' | 'Put Sell' | 'Range Sell' | 'No Sell';

export interface SellingSetupSummary {
  status: TradeSetupStatus;
  type: SellingSetupType;
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
  ceFairLabel?: Richness | null;
  peFairLabel?: Richness | null;
}

export interface PremiumDecaySide {
  optionType: 'CE' | 'PE';
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
  optionType: 'CE' | 'PE';
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
  cePattern: RolloverPattern;
  pePattern: RolloverPattern;
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
  option_type: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
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

export type SignalVerdict = 'Working' | 'Mixed' | 'Losing' | 'Too few';

/** Outcome stats for one slice of the logged signals, e.g. "Setup: SELL CE". */
export interface SignalBreakdownRow {
  group: string;
  label: string;
  total: number;
  scored: number;
  winRate: number | null;
  averageReturn: number | null;
  averageMaxAdverse: number | null;
  verdict: SignalVerdict;
}
