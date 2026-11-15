// @ts-check
import { Side } from '../tradeEnums.js';
import { SetupOutcomeStatus } from '../appEnums.js';
import { MIN_CANDLES, analyzeStock } from './analysis.js';

/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 * @typedef {import('../stockSetups.js').Setup} Setup
 * @typedef {import('../stockSetups.js').SetupOutcome} SetupOutcome
 */

/** Setups are tracked this many sessions before they expire. */
export const SETUP_HOLD_SESSIONS = 20;
/** Calendar days of past sessions the scorecard backfill replays: about 250 sessions. */
export const SETUP_BACKFILL_DAYS = 365;

/**
 * Follow a setup through the sessions after its signal date. The stop wins when one
 * session touches both stop and target: the cautious reading of a daily candle.
 * @param {{ direction: import('../tradeEnums.js').SideId, entry: number, stop: number, target: number }} setup
 * @param {Candle[]} after  sessions after the signal date, oldest first
 * @returns {SetupOutcome}
 */
export function evaluateSetup(setup, after) {
  const buy = setup.direction === Side.BUY;
  let favorable = 0;
  let adverse = 0;
  let sessions = 0;
  for (const c of after.slice(0, SETUP_HOLD_SESSIONS)) {
    sessions++;
    favorable = Math.max(favorable, buy ? c.high / setup.entry - 1 : 1 - c.low / setup.entry);
    adverse = Math.max(adverse, buy ? 1 - c.low / setup.entry : c.high / setup.entry - 1);
    const hitStop = buy ? c.low <= setup.stop : c.high >= setup.stop;
    const hitTarget = buy ? c.high >= setup.target : c.low <= setup.target;
    if (hitStop || hitTarget) {
      return { status: hitStop ? SetupOutcomeStatus.Stop : SetupOutcomeStatus.Target, resolvedDate: c.date, sessionsHeld: sessions, maxFavorablePct: favorable * 100, maxAdversePct: adverse * 100 };
    }
  }
  const done = sessions >= SETUP_HOLD_SESSIONS;
  return {
    status: done ? SetupOutcomeStatus.Expired : SetupOutcomeStatus.Open,
    resolvedDate: done ? after[SETUP_HOLD_SESSIONS - 1].date : null,
    sessionsHeld: sessions,
    maxFavorablePct: sessions ? favorable * 100 : null,
    maxAdversePct: sessions ? adverse * 100 : null,
  };
}

/**
 * Replay the after-close scan over past sessions: the setups each session from
 * `fromDate` on would have shown, each followed through the sessions after it.
 * Each session only sees candles up to its own close, as the nightly scan did.
 * @param {Candle[]} candles  oldest first
 * @param {string} fromDate  YYYY-MM-DD, first session to replay
 * @returns {Array<Setup & { outcome: SetupOutcome }>}
 */
export function replaySetups(candles, fromDate) {
  /** @type {Array<Setup & { outcome: SetupOutcome }>} */
  const found = [];
  const first = candles.findIndex((c) => c.date >= fromDate);
  if (first < 0) return found;
  for (let i = Math.max(first, MIN_CANDLES - 1); i < candles.length; i++) {
    const analysis = analyzeStock(candles.slice(0, i + 1));
    if (!analysis) continue;
    const after = candles.slice(i + 1);
    for (const setup of analysis.setups) found.push({ ...setup, outcome: evaluateSetup(setup, after) });
  }
  return found;
}
