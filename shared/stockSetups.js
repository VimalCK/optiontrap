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
 * 3. Market check: the stock's 20-session move against NIFTY 50, so a stock
 *    falling on its own news reads differently from one falling with the market.
 * 4. State and setups: whether the stock is falling, stretched, turning or
 *    trending, and any buy or sell setup on the latest session, each with an
 *    entry, stop, target and reward-to-risk.
 * 5. Outcomes: whether a past setup reached its target or stop first.
 */

/**
 * @typedef {{ date: string, open: number, high: number, low: number, close: number, volume: number }} Candle
 * @typedef {'swing-low' | 'swing-high' | 'volume' | 'sma50' | 'sma200' | 'round'} LevelKind
 * @typedef {{ price: number, kind: LevelKind, weight: number }} Level
 * @typedef {{ tests: number, held: number, failed: number, avgMovePct: number | null }} ZoneHistory
 * @typedef {{ low: number, high: number, mid: number, score: number, strength: 1 | 2 | 3, reasons: string[], side: 'support' | 'resistance', distancePct: number, history: ZoneHistory }} Zone
 * @typedef {'falling' | 'stretched' | 'turning' | 'uptrend' | 'sideways'} StockState
 * @typedef {'with-market' | 'alone' | 'stronger' | 'in-line'} MarketRelation
 * @typedef {{ stockPct: number, marketPct: number, relativePct: number, relation: MarketRelation }} MarketCheck
 * @typedef {'pullback' | 'reversal' | 'breakout' | 'rejection' | 'breakdown'} SetupType
 * @typedef {{ type: SetupType, direction: 'buy' | 'sell', label: string, date: string, entry: number, stop: number, target: number, rewardRisk: number, zone: { low: number, high: number, mid: number }, note: string }} Setup
 * @typedef {{ sma20: number | null, sma50: number | null, sma200: number | null, atr: number | null, rsi: number | null, avgVolume20: number | null }} Indicators
 * @typedef {{ price: number, date: string, state: StockState, stateNote: string, indicators: Indicators, supports: Zone[], resistances: Zone[], market: MarketCheck | null, setups: Setup[], plan: string }} StockAnalysis
 * @typedef {{ status: 'open' | 'target' | 'stop' | 'expired', resolvedDate: string | null, sessionsHeld: number, maxFavorablePct: number | null, maxAdversePct: number | null }} SetupOutcome
 */

/** Candles needed before any analysis: a 50-day average plus room to find swings. */
export const MIN_CANDLES = 60;
/** Sessions on each side a swing low/high must beat. */
const SWING_SPAN = 3;
/** Swings and volume areas come from this recent window; older levels matter less to today's price. */
const LEVEL_LOOKBACK = 250;
const VOLUME_LOOKBACK = 120;
/** A volume area must carry this multiple of the median price bin's volume. */
const VOLUME_NODE_RATIO = 1.5;
const MAX_ZONES_PER_SIDE = 3;
/** Sessions of history a zone test gets to resolve, and how far it must go to count. */
const TEST_WINDOW = 20;
const MARKET_WINDOW = 20;
/** Setups are tracked this many sessions before they expire. */
export const SETUP_HOLD_SESSIONS = 20;
const BREAKOUT_VOLUME_RATIO = 1.5;
const MIN_REWARD_RISK = 1;

/** The NIFTY 50 instrument token on Kite: the market reference. */
export const NIFTY_50_TOKEN = 256265;

const SETUP_LABELS = /** @type {Record<SetupType, string>} */ ({
  pullback: 'Pullback to support',
  reversal: 'Reversal at support',
  breakout: 'Breakout',
  rejection: 'Rejected at resistance',
  breakdown: 'Breakdown',
});

/** Human label for a setup type. */
export function setupLabel(/** @type {SetupType} */ type) {
  return SETUP_LABELS[type];
}

// ── Candles ──────────────────────────────────────────────────────────────

/**
 * Kite historical rows ([timestamp, open, high, low, close, volume, ...]) to candles,
 * oldest first, dropping malformed rows.
 * @param {unknown[][]} raw
 * @returns {Candle[]}
 */
export function parseKiteCandles(raw) {
  /** @type {Candle[]} */
  const candles = [];
  for (const row of raw || []) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [ts, open, high, low, close, volume] = row;
    if (typeof ts !== 'string' || ![open, high, low, close, volume].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    candles.push({ date: ts.slice(0, 10), open: /** @type {number} */ (open), high: /** @type {number} */ (high), low: /** @type {number} */ (low), close: /** @type {number} */ (close), volume: /** @type {number} */ (volume) });
  }
  return candles.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A watchlist instrument this feature covers: an NSE cash stock. Indices are stored
 * as NSE EQ too, but their names contain a space ("NIFTY 50") and stock symbols never do.
 * @param {{ exchange: string, tradingsymbol: string, instrumentType?: string }} instrument
 */
export function isCashStock(instrument) {
  return instrument.exchange === 'NSE'
    && (instrument.instrumentType === undefined || instrument.instrumentType === 'EQ')
    && !/\s/.test(instrument.tradingsymbol);
}

// ── Indicators ───────────────────────────────────────────────────────────

/** Mean of the last `n` values ending before index `end`, or null without enough data. */
function sma(/** @type {number[]} */ values, /** @type {number} */ n, end = values.length) {
  if (end < n) return null;
  let sum = 0;
  for (let i = end - n; i < end; i++) sum += values[i];
  return sum / n;
}

/**
 * Wilder's average true range over `n` sessions, ending at the last candle.
 * @param {Candle[]} candles
 */
export function averageTrueRange(candles, n = 14) {
  if (candles.length < n + 1) return null;
  /** @type {number[]} */
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atr = ranges.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < ranges.length; i++) atr = (atr * (n - 1) + ranges[i]) / n;
  return atr;
}

/** Wilder's RSI over `n` sessions. 100 when there were no down closes. */
export function relativeStrengthIndex(/** @type {number[]} */ closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(change, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-change, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** @param {Candle[]} candles @returns {Indicators} */
export function indicatorsOf(candles) {
  const closes = candles.map((c) => c.close);
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    atr: averageTrueRange(candles),
    rsi: relativeStrengthIndex(closes.slice(-150)),
    avgVolume20: sma(candles.map((c) => c.volume), 20),
  };
}

// ── Levels and zones ─────────────────────────────────────────────────────

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
    if (isLow) levels.push({ price: candles[i].low, kind: 'swing-low', weight });
    if (isHigh) levels.push({ price: candles[i].high, kind: 'swing-high', weight });
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
    .map((node, rank) => ({ price: node.price, kind: /** @type {const} */ ('volume'), weight: rank < 3 ? 1.5 : 1 }));
}

/** Step between "round" prices for a price level: 100 near ₹1,540, 500 near ₹8,000, 10 near ₹250. */
export function roundStep(/** @type {number} */ price) {
  const step = 10 ** (Math.floor(Math.log10(price)) - 1);
  return price / step >= 50 ? step * 5 : step;
}

/** Round-number levels within 12% of price. @returns {Level[]} */
function roundLevels(/** @type {number} */ price) {
  const step = roundStep(price);
  /** @type {Level[]} */
  const levels = [];
  for (let p = Math.floor(price * 0.88 / step) * step; p <= price * 1.12; p += step) {
    if (p > 0) levels.push({ price: p, kind: 'round', weight: 0.5 });
  }
  return levels;
}

const REASON_TEXT = /** @type {Record<LevelKind, string>} */ ({
  'swing-low': 'swing low',
  'swing-high': 'swing high',
  volume: 'high-volume area',
  sma50: '50-day average',
  sma200: '200-day average',
  round: 'round number',
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
    .filter((group) => group.some((l) => l.kind !== 'round'))
    .map((group) => {
      let low = group[0].price;
      let high = group[group.length - 1].price;
      if (high - low < 0.3 * atr) {
        const pad = (0.3 * atr - (high - low)) / 2;
        low -= pad;
        high += pad;
      }
      /** @type {Map<LevelKind, number>} */
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
function strengthOf(score) {
  return score >= 3 ? 3 : score >= 1.75 ? 2 : 1;
}

/**
 * How often price held at a zone in the past. A test is a session that reaches the
 * zone after the previous five stayed clear of it. Support holds when price then
 * rises `movePct` above the zone before closing `failPct` below it; resistance mirrors that.
 * @param {Candle[]} candles  all history before the latest session
 * @param {{ low: number, high: number, mid: number }} zone
 * @param {'support' | 'resistance'} side
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
  const touches = (/** @type {Candle} */ c) => (side === 'support' ? c.low <= zone.high : c.high >= zone.low);
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
      const move = side === 'support' ? c.high / zone.mid - 1 : 1 - c.low / zone.mid;
      best = Math.max(best, move);
      const broke = side === 'support' ? c.close < zone.low * (1 - failPct) : c.close > zone.high * (1 + failPct);
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

// ── Market, state, setups ────────────────────────────────────────────────

/**
 * The stock's move over the last MARKET_WINDOW sessions against NIFTY 50 over the same dates.
 * @param {Candle[]} stock
 * @param {Candle[]} market
 * @returns {MarketCheck | null}
 */
export function marketCheck(stock, market) {
  if (stock.length <= MARKET_WINDOW || market.length === 0) return null;
  const end = stock[stock.length - 1];
  const start = stock[stock.length - 1 - MARKET_WINDOW];
  const marketByDate = new Map(market.map((c) => [c.date, c.close]));
  const marketEnd = marketByDate.get(end.date);
  const marketStart = marketByDate.get(start.date);
  if (!marketEnd || !marketStart) return null;
  const stockPct = (end.close / start.close - 1) * 100;
  const marketPct = (marketEnd / marketStart - 1) * 100;
  const relativePct = stockPct - marketPct;
  /** @type {MarketRelation} */
  let relation = 'in-line';
  if (stockPct <= -3 && relativePct <= -3) relation = 'alone';
  else if (stockPct < 0 && marketPct <= -3) relation = 'with-market';
  else if (relativePct >= 3) relation = 'stronger';
  return { stockPct, marketPct, relativePct, relation };
}

/**
 * @param {Candle[]} candles
 * @param {Indicators} ind
 * @returns {{ state: StockState, note: string }}
 */
export function stockState(candles, ind) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recent = candles.slice(-20);
  const lowestIdx = recent.reduce((best, c, i) => (c.low < recent[best].low ? i : best), 0);
  const newLow = lowestIdx >= recent.length - 2;
  const stretch = ind.sma20 !== null && ind.atr ? (ind.sma20 - last.close) / ind.atr : 0;
  const down = ind.sma50 !== null && last.close < ind.sma50;
  const fell = candles.length > 20 && last.close < candles[candles.length - 21].close * 0.95;

  if (newLow) {
    if (stretch >= 2 || (ind.rsi !== null && ind.rsi < 30)) {
      return { state: 'stretched', note: `Fell ${stretch.toFixed(1)} daily ranges below its 20-day average${ind.rsi !== null ? `, RSI ${ind.rsi.toFixed(0)}` : ''}. Bounces get likely, but the fall can continue.` };
    }
    return { state: 'falling', note: 'Making new lows. Wait for it to stop before buying.' };
  }
  if ((down || fell) && last.close > prev.high) {
    return { state: 'turning', note: `Closed above the previous session's high (${prev.high.toFixed(2)}) without a new low: the first sign the fall is pausing.` };
  }
  if (ind.sma50 !== null && last.close > ind.sma50 && ind.sma20 !== null && ind.sma20 > ind.sma50) {
    return { state: 'uptrend', note: 'Above its rising 20- and 50-day averages. Dips to support are the entries.' };
  }
  if (down) return { state: 'falling', note: 'Below its 50-day average, though not at a new low.' };
  return { state: 'sideways', note: 'No clear trend.' };
}

/**
 * @param {SetupType} type
 * @param {Candle} last
 * @param {number} entry
 * @param {number} stop
 * @param {number} target
 * @param {{ low: number, high: number, mid: number }} zone
 * @param {string} note
 * @returns {Setup | null}
 */
function makeSetup(type, last, entry, stop, target, zone, note) {
  const direction = type === 'rejection' || type === 'breakdown' ? 'sell' : 'buy';
  const risk = direction === 'buy' ? entry - stop : stop - entry;
  const reward = direction === 'buy' ? target - entry : entry - target;
  if (!(risk > 0) || !(reward > 0)) return null;
  const rewardRisk = reward / risk;
  if (rewardRisk < MIN_REWARD_RISK) return null;
  return { type, direction, label: SETUP_LABELS[type], date: last.date, entry, stop, target, rewardRisk, zone, note };
}

/**
 * Setups on the latest session. Buy setups are entries; sell setups are exits or
 * reasons to avoid, since cash stocks can't be shorted overnight.
 * @param {Candle[]} candles
 * @param {Indicators} ind
 * @param {StockState} state
 * @param {Zone[]} supports  nearest first
 * @param {Zone[]} resistances  nearest first
 * @param {{ low: number, high: number, mid: number }[]} allZones  every zone, for breakouts and breakdowns
 * @returns {Setup[]}
 */
export function findSetups(candles, ind, state, supports, resistances, allZones) {
  const atr = ind.atr;
  if (!atr) return [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const heavyVolume = ind.avgVolume20 !== null && last.volume >= BREAKOUT_VOLUME_RATIO * ind.avgVolume20;
  const support = supports[0];
  const resistance = resistances[0];
  const upTarget = (/** @type {number} */ entry, /** @type {number} */ stop) => resistance?.low ?? entry + 2 * (entry - stop);
  const downTarget = (/** @type {number} */ entry, /** @type {number} */ stop) => supports.find((s) => s.high < entry)?.high ?? entry - 2 * (stop - entry);
  /** @type {(Setup | null)[]} */
  const found = [];

  const longTrendUp = ind.sma200 !== null ? last.close > ind.sma200 : ind.sma50 !== null && last.close > ind.sma50;
  if (support && longTrendUp && last.low <= support.high && last.close >= support.low && last.close >= (last.high + last.low) / 2) {
    const stop = support.low - 0.5 * atr;
    found.push(makeSetup('pullback', last, last.close, stop, upTarget(last.close, stop), support, 'Dipped into support in an uptrend and closed in the upper half of the day.'));
  }

  if (state === 'turning' && support) {
    const recentLow = Math.min(...candles.slice(-5).map((c) => c.low));
    if (recentLow <= support.high + 0.25 * atr) {
      const stop = Math.min(recentLow, support.low) - 0.25 * atr;
      found.push(makeSetup('reversal', last, last.close, stop, upTarget(last.close, stop), support, 'Held a support zone and closed above the previous high.'));
    }
  }

  for (const zone of allZones) {
    if (heavyVolume && prev.close <= zone.high && last.close > zone.high) {
      const stop = zone.low - 0.25 * atr;
      const above = resistances.find((r) => r.low > last.close);
      found.push(makeSetup('breakout', last, last.close, stop, above?.low ?? last.close + 2 * (last.close - stop), zone, 'Closed above a resistance zone on heavy volume.'));
      break;
    }
  }
  for (const zone of [...allZones].reverse()) {
    if (heavyVolume && prev.close >= zone.low && last.close < zone.low) {
      const stop = zone.high + 0.25 * atr;
      const below = supports.find((s) => s.high < last.close);
      found.push(makeSetup('breakdown', last, last.close, stop, below?.high ?? last.close - 2 * (stop - last.close), zone, 'Closed below a support zone on heavy volume.'));
      break;
    }
  }

  if (resistance && last.high >= resistance.low && last.close < resistance.low && last.close < last.open && (ind.sma50 === null || last.close < ind.sma50)) {
    const stop = resistance.high + 0.5 * atr;
    found.push(makeSetup('rejection', last, last.close, stop, downTarget(last.close, stop), resistance, 'Rallied into resistance in a downtrend and closed lower.'));
  }

  return /** @type {Setup[]} */ (found.filter(Boolean));
}

/**
 * Full analysis for one stock. `price` is the live price; without it the last close is used.
 * Zones and setups always come from completed sessions.
 * @param {Candle[]} candles  oldest first
 * @param {{ price?: number, market?: Candle[] }} [options]
 * @returns {StockAnalysis | null}
 */
export function analyzeStock(candles, options = {}) {
  if (candles.length < MIN_CANDLES) return null;
  const last = candles[candles.length - 1];
  const price = options.price && options.price > 0 ? options.price : last.close;
  const ind = indicatorsOf(candles);
  const atr = ind.atr ?? last.close * 0.02;
  const tolerance = Math.max(0.5 * atr, 0.006 * price);

  /** @type {Level[]} */
  const levels = [...swingLevels(candles), ...volumeLevels(candles, Math.max(0.5 * atr, 0.005 * price)), ...roundLevels(price)];
  if (ind.sma50 !== null) levels.push({ price: ind.sma50, kind: 'sma50', weight: 0.75 });
  if (ind.sma200 !== null) levels.push({ price: ind.sma200, kind: 'sma200', weight: 1 });

  const merged = mergeLevels(levels, tolerance, atr);
  const history = candles.slice(0, -1);
  const movePct = Math.max(0.03, (2 * atr) / price);
  const failPct = Math.max(0.02, atr / price);
  /** @param {ReturnType<typeof mergeLevels>[number]} z @param {'support' | 'resistance'} side @returns {Zone} */
  const toZone = (z, side) => ({
    ...z,
    strength: strengthOf(z.score),
    side,
    distancePct: (z.mid / price - 1) * 100,
    history: zoneHistory(history, z, side, movePct, failPct),
  });

  // A zone containing the price counts as support: it is where a buyer would act now.
  const supports = merged.filter((z) => z.low <= price).sort((a, b) => b.mid - a.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, 'support'));
  const resistances = merged.filter((z) => z.low > price).sort((a, b) => a.mid - b.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, 'resistance'));

  const { state, note } = stockState(candles, ind);
  // Setups use the last close's view of support and resistance, not the live price.
  const closeSupports = price === last.close ? supports : merged.filter((z) => z.low <= last.close).sort((a, b) => b.mid - a.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, 'support'));
  const closeResistances = price === last.close ? resistances : merged.filter((z) => z.low > last.close).sort((a, b) => a.mid - b.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, 'resistance'));
  const setups = findSetups(candles, ind, state, closeSupports, closeResistances, merged.filter((z) => z.score >= 1.75));
  const market = options.market ? marketCheck(candles, options.market) : null;

  return {
    price,
    date: last.date,
    state,
    stateNote: note,
    indicators: ind,
    supports,
    resistances,
    market,
    setups,
    plan: planText(state, price, supports, resistances, atr, last),
  };
}

/** Rupee price with two decimals. */
const rs = (/** @type {number} */ v) => `₹${v.toFixed(2)}`;

/**
 * A one-paragraph plan for when there's no setup today.
 * @param {StockState} state
 * @param {number} price
 * @param {Zone[]} supports
 * @param {Zone[]} resistances
 * @param {number} atr
 * @param {Candle} last
 */
export function planText(state, price, supports, resistances, atr, last) {
  const zone = supports.find((z) => z.strength >= 2) ?? supports[0];
  const target = resistances[0];
  if (!zone) return 'No support zone below the price in the stored history: no level-based entry.';
  const stop = zone.low - 0.5 * atr;
  const where = zone.low <= price && price <= zone.high ? `Price is inside the ${rs(zone.low)}–${rs(zone.high)} zone` : `Next buy zone ${rs(zone.low)}–${rs(zone.high)} (${zone.distancePct.toFixed(1)}%)`;
  const held = zone.history.tests ? `, held ${zone.history.held} of ${zone.history.tests} past tests` : '';
  const exit = target ? ` First resistance ${rs(target.low)}.` : '';
  if (state === 'falling' || state === 'stretched') {
    return `${where}${held}. Wait: buy only after a daily close above the previous session's high near the zone; stop below ${rs(stop)}.${exit}`;
  }
  if (state === 'turning') {
    return `${where}${held}. The fall is pausing: a buy above ${rs(last.high)} with a stop below ${rs(stop)} has a defined risk.${exit}`;
  }
  return `${where}${held}. Buy dips into the zone that close strong; stop below ${rs(stop)}.${exit}`;
}

// ── Outcomes ─────────────────────────────────────────────────────────────

/**
 * Follow a setup through the sessions after its signal date. The stop wins when one
 * session touches both stop and target: the cautious reading of a daily candle.
 * @param {{ direction: 'buy' | 'sell', entry: number, stop: number, target: number }} setup
 * @param {Candle[]} after  sessions after the signal date, oldest first
 * @returns {SetupOutcome}
 */
export function evaluateSetup(setup, after) {
  const buy = setup.direction === 'buy';
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
      return { status: hitStop ? 'stop' : 'target', resolvedDate: c.date, sessionsHeld: sessions, maxFavorablePct: favorable * 100, maxAdversePct: adverse * 100 };
    }
  }
  const done = sessions >= SETUP_HOLD_SESSIONS;
  return {
    status: done ? 'expired' : 'open',
    resolvedDate: done ? after[SETUP_HOLD_SESSIONS - 1].date : null,
    sessionsHeld: sessions,
    maxFavorablePct: sessions ? favorable * 100 : null,
    maxAdversePct: sessions ? adverse * 100 : null,
  };
}

/**
 * The compact per-stock summary the watchlist's Setups column shows.
 * @param {StockAnalysis} analysis
 */
export function scanSummary(analysis) {
  const support = analysis.supports[0];
  const resistance = analysis.resistances[0];
  return {
    date: analysis.date,
    close: analysis.price,
    state: analysis.state,
    setups: analysis.setups.map((s) => ({ type: s.type, direction: s.direction, label: s.label, entry: s.entry, stop: s.stop, target: s.target, rewardRisk: s.rewardRisk })),
    support: support ? { low: support.low, high: support.high, strength: support.strength } : null,
    resistance: resistance ? { low: resistance.low, high: resistance.high, strength: resistance.strength } : null,
    market: analysis.market?.relation ?? null,
  };
}
