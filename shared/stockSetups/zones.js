// @ts-check
import { LevelKind, LevelSide } from '../analysisEnums.js';

/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 * @typedef {import('../stockSetups.js').Level} Level
 * @typedef {import('../stockSetups.js').LevelKindId} LevelKindId
 * @typedef {import('../stockSetups.js').LevelSideId} LevelSideId
 * @typedef {import('../stockSetups.js').ZoneHistory} ZoneHistory
 */

/** Sessions on each side a swing low/high must beat. */
const SWING_SPAN = 3;
/** Swings and volume areas come from this recent window; older levels matter less to today's price. */
const LEVEL_LOOKBACK = 250;
const VOLUME_LOOKBACK = 120;
/** A volume area must carry this multiple of the median price bin's volume. */
const VOLUME_NODE_RATIO = 1.5;
/** Sessions of history a zone test gets to resolve, and how far it must go to count. */
const TEST_WINDOW = 20;

/**
 * Swing lows and highs: a session whose low (high) is the lowest (highest) of the
 * SWING_SPAN sessions on each side. The last SWING_SPAN sessions can't be confirmed yet.
 * Recent swings weigh more than old ones.
 * @param {Candle[]} candles
 * @returns {Level[]}
 */
export function swingLevels(candles) {
  /** @type {Level[]} */
  const levels = [];
  const start = Math.max(SWING_SPAN, candles.length - LEVEL_LOOKBACK);
  for (let i = start; i < candles.length - SWING_SPAN; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - SWING_SPAN; j <= i + SWING_SPAN; j++) {
      if (j === i) continue;
      // On a tie the earlier session is the swing, so two equal lows still count once.
      const earlier = j < i;
      if (earlier ? candles[j].low <= candles[i].low : candles[j].low < candles[i].low) isLow = false;
      if (earlier ? candles[j].high >= candles[i].high : candles[j].high > candles[i].high) isHigh = false;
    }
    const weight = candles.length - i <= 60 ? 1 : 0.7;
    if (isLow) levels.push({ price: candles[i].low, kind: LevelKind.SwingLow, weight });
    if (isHigh) levels.push({ price: candles[i].high, kind: LevelKind.SwingHigh, weight });
  }
  return levels;
}

/**
 * High-volume price areas over the recent window: each session's volume is spread
 * evenly across its high–low range in price bins, and bins that stand out from
 * their neighbours become levels.
 * @param {Candle[]} candles
 * @param {number} binWidth
 * @returns {Level[]}
 */
export function volumeLevels(candles, binWidth) {
  const recent = candles.slice(-VOLUME_LOOKBACK).filter((c) => c.volume > 0 && c.high >= c.low);
  if (recent.length < 20 || !(binWidth > 0)) return [];
  const lowest = Math.min(...recent.map((c) => c.low));
  const highest = Math.max(...recent.map((c) => c.high));
  const binCount = Math.max(1, Math.ceil((highest - lowest) / binWidth) + 1);
  if (binCount > 2000) return [];
  const bins = new Array(binCount).fill(0);
  for (const c of recent) {
    const first = Math.floor((c.low - lowest) / binWidth);
    const last = Math.floor((c.high - lowest) / binWidth);
    const share = c.volume / (last - first + 1);
    for (let b = first; b <= last; b++) bins[b] += share;
  }
  const filled = bins.filter((v) => v > 0).sort((a, b) => a - b);
  const median = filled[Math.floor(filled.length / 2)] ?? 0;
  /** @type {{ price: number, volume: number }[]} */
  const nodes = [];
  for (let b = 0; b < binCount; b++) {
    const v = bins[b];
    if (v < VOLUME_NODE_RATIO * median) continue;
    if (v < (bins[b - 1] ?? 0) || v < (bins[b + 1] ?? 0)) continue;
    nodes.push({ price: lowest + (b + 0.5) * binWidth, volume: v });
  }
  return nodes
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6)
    .map((node, rank) => ({ price: node.price, kind: LevelKind.Volume, weight: rank < 3 ? 1.5 : 1 }));
}

/** Step between "round" prices for a price level: 100 near ₹1,540, 500 near ₹8,000, 10 near ₹250. */
export function roundStep(/** @type {number} */ price) {
  const step = 10 ** (Math.floor(Math.log10(price)) - 1);
  return price / step >= 50 ? step * 5 : step;
}

/** Round-number levels within 12% of price. @returns {Level[]} */
export function roundLevels(/** @type {number} */ price) {
  const step = roundStep(price);
  /** @type {Level[]} */
  const levels = [];
  for (let p = Math.floor(price * 0.88 / step) * step; p <= price * 1.12; p += step) {
    if (p > 0) levels.push({ price: p, kind: LevelKind.Round, weight: 0.5 });
  }
  return levels;
}

const REASON_TEXT = /** @type {Record<LevelKindId, string>} */ ({
  [LevelKind.SwingLow]: 'swing low',
  [LevelKind.SwingHigh]: 'swing high',
  [LevelKind.Volume]: 'high-volume area',
  [LevelKind.Sma50]: '50-day average',
  [LevelKind.Sma200]: '200-day average',
  [LevelKind.Round]: 'round number',
});

/**
 * Merge levels within `tolerance` of each other into zones. A zone made only of
 * round numbers is dropped: on their own they are weak.
 * @param {Level[]} levels
 * @param {number} tolerance
 * @param {number} atr
 */
export function mergeLevels(levels, tolerance, atr) {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  /** @type {Level[][]} */
  const groups = [];
  for (const level of sorted) {
    const group = groups[groups.length - 1];
    if (group && level.price - group[group.length - 1].price <= tolerance) group.push(level);
    else groups.push([level]);
  }
  return groups
    .filter((group) => group.some((l) => l.kind !== LevelKind.Round))
    .map((group) => {
      let low = group[0].price;
      let high = group[group.length - 1].price;
      if (high - low < 0.3 * atr) {
        const pad = (0.3 * atr - (high - low)) / 2;
        low -= pad;
        high += pad;
      }
      /** @type {Map<LevelKindId, number>} */
      const counts = new Map();
      for (const l of group) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
      // Repeated touches of the same kind add less than a new kind of evidence.
      let score = 0;
      for (const kind of counts.keys()) {
        const weights = group.filter((l) => l.kind === kind).map((l) => l.weight).sort((a, b) => b - a);
        score += weights[0] + 0.5 * weights.slice(1, 3).reduce((a, b) => a + b, 0);
      }
      const reasons = [...counts].map(([kind, count]) => (count > 1 ? `${REASON_TEXT[kind]} ×${count}` : REASON_TEXT[kind]));
      return { low, high, mid: (low + high) / 2, score, reasons };
    });
}

/** @param {number} score @returns {1 | 2 | 3} */
export function strengthOf(score) {
  return score >= 3 ? 3 : score >= 1.75 ? 2 : 1;
}

/**
 * How often price held at a zone in the past. A test is a session that reaches the
 * zone after the previous five stayed clear of it. Support holds when price then
 * rises `movePct` above the zone before closing `failPct` below it; resistance mirrors that.
 * @param {Candle[]} candles  all history before the latest session
 * @param {{ low: number, high: number, mid: number }} zone
 * @param {LevelSideId} side
 * @param {number} movePct
 * @param {number} failPct
 * @returns {ZoneHistory}
 */
export function zoneHistory(candles, zone, side, movePct, failPct) {
  let tests = 0;
  let held = 0;
  let failed = 0;
  /** @type {number[]} */
  const moves = [];
  const touches = (/** @type {Candle} */ c) => (side === LevelSide.Support ? c.low <= zone.high : c.high >= zone.low);
  for (let i = 5; i < candles.length - 1; i++) {
    if (!touches(candles[i])) continue;
    let clear = true;
    for (let j = i - 5; j < i; j++) if (touches(candles[j])) clear = false;
    if (!clear) continue;

    tests++;
    let best = 0;
    let resolved = false;
    const end = Math.min(candles.length - 1, i + TEST_WINDOW);
    for (let j = i + 1; j <= end; j++) {
      const c = candles[j];
      const move = side === LevelSide.Support ? c.high / zone.mid - 1 : 1 - c.low / zone.mid;
      best = Math.max(best, move);
      const broke = side === LevelSide.Support ? c.close < zone.low * (1 - failPct) : c.close > zone.high * (1 + failPct);
      if (broke) { failed++; resolved = true; i = j; break; }
      if (move >= movePct) { held++; resolved = true; i = j; break; }
    }
    if (!resolved) i = end;
    moves.push(best);
  }
  return {
    tests,
    held,
    failed,
    avgMovePct: moves.length ? (moves.reduce((a, b) => a + b, 0) / moves.length) * 100 : null,
  };
}
