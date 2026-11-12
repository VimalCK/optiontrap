/**
 * Intraday OI snapshots (taken every 10 minutes by the server) and the OI
 * pattern of one option across them. Shared by the Option Analyzer
 * (browser) and the Option Analyzer setups strategy (server).
 */
import { marketTimeLabel } from '../marketTime.js';
import { MoveDirection, VelocityTrend } from '../analysisEnums.js';

/**
 * @typedef {object} OiSnapshot
 * @property {number} timestamp
 * @property {string} timeLabel
 * @property {Record<string, number>} data
 * @property {Record<string, number>} [prices] token -> LTP
 * @property {Record<string, number>} [close] token -> previous day close
 * @property {number} [spot] spot of the symbol being analysed (see withSpot)
 * @property {Record<string, number>} [volumes] token -> volume
 */

/**
 * Snapshots with `spot` set to one symbol's spot price. The server stores
 * each snapshotted symbol's spot in `prices` under its price instrument's
 * token, so this picks the analysed symbol's out (undefined if not captured).
 * @param {OiSnapshot[]} snapshots
 * @param {number | null} spotToken
 * @returns {OiSnapshot[]}
 */
export function withSpot(snapshots, spotToken) {
  return snapshots.map((snap) => ({ ...snap, spot: spotToken !== null ? snap.prices?.[String(spotToken)] : undefined }));
}

/**
 * @typedef {object} VelocityPattern
 * @property {import('../analysisEnums.js').VelocityTrendId} trend
 * @property {import('../analysisEnums.js').MoveDirectionId} direction
 * @property {number[]} series Normalized OI values (0–1) across snapshots, newest last, for sparkline rendering
 * @property {number[]} rawSeries Raw OI values at each snapshot time
 * @property {string[]} timeLabels Time labels for each point in the series
 */

/**
 * Analyzes the full intraday OI history for a token across all snapshots and
 * classifies the pattern: buildup/unwinding trend, acceleration, volatility.
 *
 * Returns null if fewer than 2 data points exist (no meaningful pattern).
 * @param {number} token
 * @param {number} currentOi
 * @param {OiSnapshot[]} snapshots
 * @returns {VelocityPattern | null}
 */
export function analyzeVelocityPattern(
  token,
  currentOi,
  snapshots,
) {
  // Build time-series: each snapshot + current value
  const key = String(token);
  /** @type {{ oi: number, timeLabel: string }[]} */ const points = [];

  for (const snap of snapshots) {
    const oi = Number(snap.data[key] || 0);
    if (oi > 0) points.push({ oi, timeLabel: snap.timeLabel });
  }

  // Append current OI as the latest point (with "now" label)
  if (currentOi > 0) {
    points.push({ oi: currentOi, timeLabel: marketTimeLabel() });
  }

  if (points.length < 2) return null;

  const rawSeries = points.map((p) => p.oi);
  const timeLabels = points.map((p) => p.timeLabel);

  // Normalize to 0–1 for sparkline
  const minOi = Math.min(...rawSeries);
  const maxOi = Math.max(...rawSeries);
  const range = maxOi - minOi;
  const series = range > 0
    ? rawSeries.map((v) => (v - minOi) / range)
    : rawSeries.map(() => 0.5);

  // Compute per-interval deltas as % change
  /** @type {number[]} */ const deltas = [];
  for (let i = 1; i < rawSeries.length; i++) {
    const prev = rawSeries[i - 1];
    deltas.push(prev > 0 ? ((rawSeries[i] - prev) / prev) * 100 : 0);
  }

  const STABLE_THRESHOLD = 1.5; // % change considered negligible

  const positiveDeltas = deltas.filter((d) => d > STABLE_THRESHOLD);
  const negativeDeltas = deltas.filter((d) => d < -STABLE_THRESHOLD);
  const neutralDeltas = deltas.filter((d) => Math.abs(d) <= STABLE_THRESHOLD);

  const totalDelta = rawSeries[rawSeries.length - 1] - rawSeries[0];
  const totalPct = rawSeries[0] > 0 ? (totalDelta / rawSeries[0]) * 100 : 0;

  // Determine dominant direction
  const isMostlyUp = positiveDeltas.length > negativeDeltas.length && positiveDeltas.length > neutralDeltas.length;
  const isMostlyDown = negativeDeltas.length > positiveDeltas.length && negativeDeltas.length > neutralDeltas.length;
  const isVolatile = positiveDeltas.length > 0 && negativeDeltas.length > 0
    && Math.abs(positiveDeltas.length - negativeDeltas.length) <= 1;

  /** @type {import('../analysisEnums.js').VelocityTrendId} */ let trend;
  /** @type {import('../analysisEnums.js').MoveDirectionId} */ let direction;

  if (isVolatile && deltas.length >= 3) {
    trend = VelocityTrend.Volatile;
    direction = movedDirection(totalPct, STABLE_THRESHOLD);
  } else if (Math.abs(totalPct) <= STABLE_THRESHOLD && neutralDeltas.length >= deltas.length * 0.7) {
    trend = VelocityTrend.Stable;
    direction = MoveDirection.Neutral;
  } else if (isMostlyUp) {
    // Check acceleration: are the deltas growing or shrinking?
    if (deltas.length >= 3) {
      const firstHalf = deltas.slice(0, Math.floor(deltas.length / 2));
      const secondHalf = deltas.slice(Math.floor(deltas.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d, 0) / secondHalf.length;
      if (secondAvg > firstAvg + 1) trend = VelocityTrend.AcceleratingBuildup;
      else if (secondAvg < firstAvg - 1) trend = VelocityTrend.SlowingBuildup;
      else trend = VelocityTrend.SteadyBuildup;
    } else {
      trend = VelocityTrend.Buildup;
    }
    direction = MoveDirection.Up;
  } else if (isMostlyDown) {
    if (deltas.length >= 3) {
      const firstHalf = deltas.slice(0, Math.floor(deltas.length / 2));
      const secondHalf = deltas.slice(Math.floor(deltas.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d, 0) / secondHalf.length;
      if (secondAvg < firstAvg - 1) trend = VelocityTrend.AcceleratingUnwind;
      else if (secondAvg > firstAvg + 1) trend = VelocityTrend.SlowingUnwind;
      else trend = VelocityTrend.SteadyUnwind;
    } else {
      trend = VelocityTrend.Unwinding;
    }
    direction = MoveDirection.Down;
  } else {
    // Leaning mixed
    trend = totalPct > STABLE_THRESHOLD ? VelocityTrend.MildBuildup : totalPct < -STABLE_THRESHOLD ? VelocityTrend.MildUnwind : VelocityTrend.Stable;
    direction = movedDirection(totalPct, STABLE_THRESHOLD);
  }

  return { trend, direction, series, rawSeries, timeLabels };
}

/**
 * Up or down when `changePct` moved past `threshold` either way, else neutral.
 * @param {number} changePct
 * @param {number} threshold
 * @returns {import('../analysisEnums.js').MoveDirectionId}
 */
function movedDirection(changePct, threshold) {
  if (changePct > threshold) return MoveDirection.Up;
  return changePct < -threshold ? MoveDirection.Down : MoveDirection.Neutral;
}
