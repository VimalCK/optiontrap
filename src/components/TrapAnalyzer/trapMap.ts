import { strikeGap } from '../../../shared/optionAnalysis/setupScoring.js';
import type { OptionChainRow } from '@/services/optionChain';

/** The most strike labels the map's axis shows; more would overlap. */
const MAX_STRIKE_LABELS = 16;
/** Label steps, as multiples of the chain's strike gap: round numbers on any symbol. */
const STEP_MULTIPLES = [1, 2, 5, 10, 20, 50, 100];
/** Strikes such as 2.5 apart aren't exact in floating point. */
const EPSILON = 1e-6;

/**
 * The step between labelled strikes: the smallest round multiple of the strike
 * gap that keeps the labels within MAX_STRIKE_LABELS. 0 without a gap.
 */
export function strikeLabelStep(chain: OptionChainRow[]): number {
  const gap = strikeGap(chain);
  if (gap <= 0) return 0;
  const multiple = STEP_MULTIPLES.find((m) => chain.length / m <= MAX_STRIKE_LABELS) ?? STEP_MULTIPLES[STEP_MULTIPLES.length - 1];
  return gap * multiple;
}

/** Whether a strike sits on the label step (every strike when there is no step). */
export function isLabelledStrike(strike: number, step: number): boolean {
  if (step <= 0) return true;
  const remainder = Math.abs(strike % step);
  return remainder < EPSILON || step - remainder < EPSILON;
}
