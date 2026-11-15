/**
 * The Option Analyzer's Strategy card scoring (sell and buy setups). It lives
 * in shared/optionAnalysis/ (sellSetups.js, buySetups.js, setupScoring.js), so the trade
 * engine's Option Analyzer setups strategy scores a chain the same way; this module re-exports it.
 */
export { computeSellRecommendations, type SellRecommendation, type ScoreBreakdown } from '../../shared/optionAnalysis/sellSetups.js';
export { computeBuyRecommendations, type BuyRecommendation, type BuyScoreBreakdown } from '../../shared/optionAnalysis/buySetups.js';
export { strikeGap } from '../../shared/optionAnalysis/setupScoring.js';
