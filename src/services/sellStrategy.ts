/**
 * The Option Analyzer's Strategy card scoring (sell and buy setups). It lives
 * in shared/optionAnalysis/setups.js, so the trade engine's Option Analyzer
 * setups strategy scores a chain the same way; this module re-exports it.
 */
export * from '../../shared/optionAnalysis/setups.js';
