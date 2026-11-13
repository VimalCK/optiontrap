import type { PayoffPoint } from '@/services/positionRisk';

/**
 * Rounded ("nice") axis ticks covering [min, max]: the step comes from the 1/2/5 × 10ⁿ family, so labels land
 * on clean numbers (620, 640, 660 rather than 621, 643, 665).
 */
export function niceTicks(min: number, max: number, targetCount: number): number[] {
  const span = max - min;
  if (span <= 0) return [Math.round(min)];

  const rawStep = span / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;

  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/** The payoff at a price, interpolated between the sampled points (the kinks are sampled, so this is exact). */
export function payoffAt(points: PayoffPoint[], price: number): number {
  if (points.length === 0) return 0;
  if (price <= points[0].price) return points[0].payoff;
  const last = points[points.length - 1];
  if (price >= last.price) return last.payoff;
  for (let i = 1; i < points.length; i++) {
    if (price <= points[i].price) {
      const a = points[i - 1];
      const b = points[i];
      const t = b.price === a.price ? 0 : (price - a.price) / (b.price - a.price);
      return a.payoff + t * (b.payoff - a.payoff);
    }
  }
  return last.payoff;
}

/** An axis value in lakh (L) or thousand (k) shorthand: 150000 → 1.5L, 2500 → 3k. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toFixed(0);
}

/** The y range the chart draws: symmetric about zero, so the zero P&L line sits at the vertical centre, with 10% headroom. */
export function payoffRange(minPayoff: number, maxPayoff: number): { yMin: number; yMax: number } {
  const bound = Math.max(Math.abs(Math.min(minPayoff, 0)), Math.abs(Math.max(maxPayoff, 0))) || 1;
  const yMax = bound + bound * 0.1;
  return { yMin: -yMax, yMax };
}

interface Vertex { x: number; y: number; payoff: number }
export interface SidePaths { line: string; area: string }

/**
 * The payoff line split at zero into its profit and loss parts, each a polyline (`line`) and a closed area to the
 * zero axis (`area`). A vertex is inserted at every zero crossing so the two colours meet exactly on the axis.
 */
export function payoffPaths(
  points: PayoffPoint[],
  xScale: (price: number) => number,
  yScale: (payoff: number) => number,
): { profit: SidePaths; loss: SidePaths } {
  const zeroY = yScale(0);
  const vertices: Vertex[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && ((prev.payoff < 0 && p.payoff > 0) || (prev.payoff > 0 && p.payoff < 0))) {
      const t = prev.payoff / (prev.payoff - p.payoff);
      vertices.push({ x: xScale(prev.price + t * (p.price - prev.price)), y: zeroY, payoff: 0 });
    }
    vertices.push({ x: xScale(p.price), y: yScale(p.payoff), payoff: p.payoff });
  });

  const side = (inSide: (v: Vertex) => boolean): SidePaths => {
    let line = '';
    let area = '';
    let run: Vertex[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const first = run[0];
        const last = run[run.length - 1];
        line += 'M ' + run.map((v) => `${v.x.toFixed(1)} ${v.y.toFixed(1)}`).join(' L ') + ' ';
        area += `M ${first.x.toFixed(1)} ${zeroY.toFixed(1)} `
          + run.map((v) => `L ${v.x.toFixed(1)} ${v.y.toFixed(1)}`).join(' ')
          + ` L ${last.x.toFixed(1)} ${zeroY.toFixed(1)} Z `;
      }
      run = [];
    };
    for (const v of vertices) {
      if (inSide(v)) run.push(v);
      else flush();
    }
    flush();
    return { line, area };
  };

  return { profit: side((v) => v.payoff >= 0), loss: side((v) => v.payoff <= 0) };
}

/** The strike within `snapPx` pixels of the cursor (the nearest wins), or null. */
export function strikeNear(cursorX: number, strikes: number[], xScale: (price: number) => number, snapPx: number): number | null {
  let best: number | null = null;
  let bestDistance = snapPx;
  for (const strike of strikes) {
    const distance = Math.abs(xScale(strike) - cursorX);
    if (distance <= bestDistance) { bestDistance = distance; best = strike; }
  }
  return best;
}
