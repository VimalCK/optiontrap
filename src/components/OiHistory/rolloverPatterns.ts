import { priceDirection, classifyOptionMove } from './helpers';
import { MoveDirection, RolloverPattern, type MoveDirectionId, type RolloverPatternId } from '../../../shared/analysisEnums.js';

/** Each directional rollover pattern by the premiums' direction: rising (Long), falling (Short), or flat. */
const ROLLING_OVER: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Up]: RolloverPattern.RollingOverLong,
  [MoveDirection.Down]: RolloverPattern.RollingOverShort,
  [MoveDirection.Neutral]: RolloverPattern.RollingOver,
};
const FRESH_BUILD: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Up]: RolloverPattern.FreshBuildLong,
  [MoveDirection.Down]: RolloverPattern.FreshBuildShort,
  [MoveDirection.Neutral]: RolloverPattern.FreshBuild,
};
const DOUBLING_DOWN: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Up]: RolloverPattern.DoublingDownLong,
  [MoveDirection.Down]: RolloverPattern.DoublingDownShort,
  [MoveDirection.Neutral]: RolloverPattern.DoublingDown,
};
/** Exiting with falling premiums is longs unwinding; with rising ones, shorts covering. */
const EXITING: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Down]: RolloverPattern.ExitingLongUnwind,
  [MoveDirection.Up]: RolloverPattern.ExitingShortCover,
  [MoveDirection.Neutral]: RolloverPattern.Exiting,
};

export function classifyPattern(
  oiByExpiry: Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>,
  expiries: string[],
): RolloverPatternId {
  // Single expiry (monthly scrips like BANKNIFTY): use OI + Price signal
  if (expiries.length < 2) {
    let entry: { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined } | undefined;
    for (const exp of expiries) {
      if (oiByExpiry.has(exp)) { entry = oiByExpiry.get(exp); break; }
    }
    if (!entry) return RolloverPattern.None;
    return classifyOptionMove(entry.oi, entry.prevOi, entry.close, entry.prevClose);
  }

  let nearestIdx = -1;
  for (let i = 0; i < expiries.length; i++) {
    if (oiByExpiry.has(expiries[i])) { nearestIdx = i; break; }
  }
  if (nearestIdx < 0) return RolloverPattern.None;

  const nearest = oiByExpiry.get(expiries[nearestIdx])!;
  const nearestChg = nearest.prevOi !== undefined && nearest.prevOi > 0
    ? (nearest.oi - nearest.prevOi) / nearest.prevOi
    : 0;

  let anyRising = false;
  let anyFalling = false;
  let farCount = 0;

  for (let i = nearestIdx + 1; i < expiries.length; i++) {
    const entry = oiByExpiry.get(expiries[i]);
    if (!entry || entry.oi === 0) continue;
    farCount++;
    const chg = entry.prevOi !== undefined && entry.prevOi > 0
      ? (entry.oi - entry.prevOi) / entry.prevOi
      : (entry.oi > 0 ? 1 : 0); // new position = rising
    if (chg > 0.02) anyRising = true;
    if (chg < -0.02) anyFalling = true;
  }

  const nearFalling = nearestChg < -0.02;
  const nearRising = nearestChg > 0.02;

  // Premium direction: rising premiums mean longs, falling ones shorts (or, exiting, the side that is leaving)
  const pDir = priceDirection(oiByExpiry, expiries);

  if (farCount === 0) {
    if (nearFalling) return EXITING[pDir];
    if (nearRising) return FRESH_BUILD[pDir];
    return RolloverPattern.Stable;
  }

  if (nearFalling && anyRising) return ROLLING_OVER[pDir];
  if (nearFalling && !anyRising && anyFalling) return RolloverPattern.Unwinding;
  if (nearFalling && !anyRising) return EXITING[pDir];
  if (nearRising && anyRising) return DOUBLING_DOWN[pDir];
  if (!nearFalling && !nearRising && anyRising) return FRESH_BUILD[pDir];
  if (!nearFalling && !nearRising && anyFalling) return RolloverPattern.Unwinding;
  return RolloverPattern.Stable;
}

/** Rollover patterns that read bullish for the option (green), bearish (red), or a roll (accent). */
const GREEN_PATTERNS: RolloverPatternId[] = [
  RolloverPattern.FreshBuildLong, RolloverPattern.FreshBuildShort, RolloverPattern.FreshBuild,
  RolloverPattern.DoublingDownLong, RolloverPattern.DoublingDownShort, RolloverPattern.DoublingDown,
  RolloverPattern.LongBuildup, RolloverPattern.ShortCovering,
];
const RED_PATTERNS: RolloverPatternId[] = [
  RolloverPattern.ExitingLongUnwind, RolloverPattern.ExitingShortCover, RolloverPattern.Exiting,
  RolloverPattern.ShortBuildup, RolloverPattern.LongUnwinding, RolloverPattern.Unwinding,
];
const ROLL_PATTERNS: RolloverPatternId[] = [RolloverPattern.RollingOverLong, RolloverPattern.RollingOverShort, RolloverPattern.RollingOver];

export function patternColor(p: RolloverPatternId): string {
  if (ROLL_PATTERNS.includes(p)) return 'var(--accent)';
  if (RED_PATTERNS.includes(p)) return 'var(--loss)';
  if (GREEN_PATTERNS.includes(p)) return 'var(--profit)';
  return 'var(--text-secondary)';
}
