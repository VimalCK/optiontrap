// @ts-check
/**
 * Stock entry and exit setups
 *
 * Pure functions over daily candles, shared by the server's after-close scan
 * and the watchlist panel in the browser, so both always agree.
 *
 * 1. Zones: prices where buyers (support) or sellers (resistance) stepped in
 *    before, from swing points, high-volume price areas, the 50/200-day
 *    averages and round numbers. Nearby levels merge; more reasons = stronger.
 * 2. History check: how often each zone actually held on this stock, counted
 *    over its whole stored history. Zones come from the same history, so the
 *    count flatters them a little; it is evidence, not proof.
 * 3. Market check: the stock's 20-session move against the market reference index, so a stock
 *    falling on its own news reads differently from one falling with the market.
 * 4. State and setups: whether the stock is falling, stretched, turning or
 *    trending, and any buy or sell setup on the latest session, each with an
 *    entry, stop, target and reward-to-risk.
 * 5. Outcomes: whether a past setup reached its target or stop first.
 */

/**
 * @typedef {{ date: string, open: number, high: number, low: number, close: number, volume: number }} Candle
 * @typedef {import('./analysisEnums.js').LevelKindId} LevelKindId
 * @typedef {import('./analysisEnums.js').LevelSideId} LevelSideId
 * @typedef {{ price: number, kind: LevelKindId, weight: number }} Level
 * @typedef {{ tests: number, held: number, failed: number, avgMovePct: number | null }} ZoneHistory
 * @typedef {{ low: number, high: number, mid: number, score: number, strength: 1 | 2 | 3, reasons: string[], side: LevelSideId, distancePct: number, history: ZoneHistory }} Zone
 * @typedef {import('./analysisEnums.js').StockStateId} StockStateId
 * @typedef {import('./analysisEnums.js').MarketRelationId} MarketRelationId
 * @typedef {{ stockPct: number, marketPct: number, relativePct: number, relation: MarketRelationId }} MarketCheck
 * @typedef {import('./analysisEnums.js').StockSetupTypeId} StockSetupTypeId
 * @typedef {{ type: StockSetupTypeId, direction: import('./tradeEnums.js').SideId, label: string, date: string, entry: number, stop: number, target: number, rewardRisk: number, zone: { low: number, high: number, mid: number }, note: string }} Setup
 * @typedef {{ sma20: number | null, sma50: number | null, sma200: number | null, atr: number | null, rsi: number | null, avgVolume20: number | null }} Indicators
 * @typedef {{ price: number, date: string, state: StockStateId, stateNote: string, indicators: Indicators, supports: Zone[], resistances: Zone[], market: MarketCheck | null, setups: Setup[], plan: string }} StockAnalysis
 * @typedef {{ status: import('./appEnums.js').SetupOutcomeStatusId, resolvedDate: string | null, sessionsHeld: number, maxFavorablePct: number | null, maxAdversePct: number | null }} SetupOutcome
 */

export { isCashStock, parseKiteCandles } from './stockSetups/candles.js';
export { averageTrueRange, relativeStrengthIndex } from './stockSetups/indicators.js';
export { mergeLevels, roundStep, swingLevels, zoneHistory } from './stockSetups/zones.js';
export { marketCheck, stockState } from './stockSetups/stockState.js';
export { findSetups, setupLabel } from './stockSetups/findSetups.js';
export { MIN_CANDLES, analyzeStock, scanSummary } from './stockSetups/analysis.js';
export { SETUP_BACKFILL_DAYS, SETUP_HOLD_SESSIONS, evaluateSetup, replaySetups } from './stockSetups/outcomes.js';
