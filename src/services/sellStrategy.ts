/**
 * The Option Analyzer's Strategy card scoring (sell and buy setups). It lives
 * in shared/optionAnalysis/ (sellSetups.js, buySetups.js, setupScoring.js), so the trade
 * engine's Option Analyzer setups strategy scores a chain the same way; this module re-exports it.
 */
export { computeSellRecommendations, SELL_SCORE_MAX, type SellRecommendation, type ScoreBreakdown, type SellReasons } from '../../shared/optionAnalysis/sellSetups.js';
export { computeBuyRecommendations, BUY_SCORE_MAX, type BuyRecommendation, type BuyScoreBreakdown, type BuyReasons } from '../../shared/optionAnalysis/buySetups.js';
export { SINGLE_OPTION_SETUPS, autoPickOf, rankSetups, setupOverview, setupSide, type SideGap } from '../../shared/optionAnalysis/setupOverview.js';
export type { DayBias, DayReadings } from '../../shared/optionAnalysis/dayBias.js';
