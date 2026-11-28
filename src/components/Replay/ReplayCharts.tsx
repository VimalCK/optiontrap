import React, { useState } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import { formatAmount } from '@/utils/formatAmount';
import { REPLAY_SQUARE_OFF_MINUTES, minutesOf } from '../../../shared/replay.js';
import { clockLabel } from '../../../shared/marketTime.js';
import { cprLevels, type CprLevels } from '../../../shared/pivotLevels.js';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import type { OptionMinute, ReplayDay } from '@/services/replay';

/** Space for the price labels on the right and the time labels below. */
const PAD = { left: 4, right: 64, top: 10, bottom: 22 };
const OPTION_COLOUR: Record<OptionTypeId, string> = { [OptionType.CE]: 'var(--profit)', [OptionType.PE]: 'var(--loss)' };
/** Time labels every half hour from the open; the crosshair reads any minute in between. */
const LABEL_STEP_MINUTES = 30;
/** The room one time label (or the crosshair's time tag) needs, with a gap to the next. */
const LABEL_WIDTH_PX = 44;
/** The last label ends at the edge instead of centring on its minute, so it needs more room from the one before. */
const LAST_LABEL_GAP_PX = LABEL_WIDTH_PX * 1.5;
const TAG_HEIGHT = 18;

/** A trade's entry or exit, marked on the index chart. */
export interface ChartMark {
  minute: number;
  optionType: OptionTypeId;
  entry: boolean;
}

/**
 * The labelled minutes, counted from the open: every LABEL_STEP_MINUTES, so no step is skipped; then the last minute,
 * unless it would overlap the last step's label at `slot` pixels a minute.
 */
export function axisMinutes(span: number, slot: number): number[] {
  const last = span - 1;
  const labels: number[] = [];
  for (let offset = 0; offset <= last; offset += LABEL_STEP_MINUTES) labels.push(offset);
  const lastStep = labels[labels.length - 1];
  return lastStep !== last && (last - lastStep) * slot >= LAST_LABEL_GAP_PX ? [...labels, last] : labels;
}

interface Frame {
  width: number;
  height: number;
  /** Clock minutes from the open to the square-off, which the time axis spans. */
  minutes: number;
  open: number;
  /** The x of the day's minute at this index (placed by its clock time, so a minute Kite skipped leaves a gap). */
  x: (index: number) => number;
  /** The x of a clock minute counted from the open. */
  xAt: (offset: number) => number;
  y: (value: number) => number;
  slot: number;
  /** The clock minute (from the open) under an x, and the value at a y: the crosshair's readings. */
  offsetAt: (x: number) => number;
  valueAt: (y: number) => number;
}

/** Scales the session from the open to the square-off (09:15–15:20) across the width, and [low, high] down the height. */
function frame(width: number, height: number, day: ReplayDay, low: number, high: number): Frame {
  const open = minutesOf(day.times[0]);
  const minutes = REPLAY_SQUARE_OFF_MINUTES - open + 1;
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const span = high - low || 1;
  const xAt = (offset: number) => PAD.left + ((offset + 0.5) / minutes) * plotWidth;
  return {
    width,
    height,
    minutes,
    open,
    slot: plotWidth / minutes,
    x: (index) => xAt(minutesOf(day.times[index]) - open),
    xAt,
    y: (value) => PAD.top + ((high - value) / span) * (height - PAD.top - PAD.bottom),
    offsetAt: (x) => Math.min(minutes - 1, Math.max(0, Math.floor(((x - PAD.left) / plotWidth) * minutes))),
    valueAt: (y) => high - ((y - PAD.top) / (height - PAD.top - PAD.bottom)) * span,
  };
}

/** The mouse's position over a chart, in the chart's pixels. */
interface Pointer {
  x: number;
  y: number;
}

/**
 * Dashed lines through the mouse: the vertical one snapped to the minute under it, with that time on the time axis,
 * and the horizontal one with the value there on the value axis. Hidden while the mouse is outside the plot.
 */
const Crosshair: React.FC<{ f: Frame; pointer: Pointer | null; label: (value: number) => string }> = ({ f, pointer, label }) => {
  const bottom = f.height - PAD.bottom;
  const right = f.width - PAD.right;
  if (!pointer || pointer.x < PAD.left || pointer.x > right || pointer.y < PAD.top || pointer.y > bottom) return null;
  const offset = f.offsetAt(pointer.x);
  const x = f.xAt(offset);
  const timeX = Math.min(right - LABEL_WIDTH_PX / 2, Math.max(PAD.left + LABEL_WIDTH_PX / 2, x));
  return (
    <g className="replay-chart__crosshair" pointerEvents="none">
      <line x1={x} x2={x} y1={PAD.top} y2={bottom} />
      <line x1={PAD.left} x2={right} y1={pointer.y} y2={pointer.y} />
      <rect x={timeX - LABEL_WIDTH_PX / 2} y={bottom + 2} width={LABEL_WIDTH_PX} height={TAG_HEIGHT} rx={4} />
      <text x={timeX} y={bottom + 15} textAnchor="middle">{clockLabel(f.open + offset)}</text>
      <AxisTag f={f} y={pointer.y} text={label(f.valueAt(pointer.y))} />
    </g>
  );
};

/** Horizontal grid lines with their values on the right, and the times along the bottom. */
const Axes: React.FC<{ f: Frame; ticks: number[]; label: (value: number) => string }> = ({ f, ticks, label }) => (
  <g className="replay-chart__axes">
    {ticks.map((tick) => (
      <g key={tick}>
        <line x1={PAD.left} x2={f.width - PAD.right} y1={f.y(tick)} y2={f.y(tick)} stroke="var(--card-border)" />
        <text x={f.width - PAD.right + 8} y={f.y(tick) + 4}>{label(tick)}</text>
      </g>
    ))}
    {axisMinutes(f.minutes, f.slot).map((offset, i, all) => (
      <g key={offset}>
        <line x1={f.xAt(offset)} x2={f.xAt(offset)} y1={PAD.top} y2={f.height - PAD.bottom} stroke="var(--card-border)" />
        <text x={f.xAt(offset)} y={f.height - 6} textAnchor={i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'}>
          {clockLabel(f.open + offset)}
        </text>
      </g>
    ))}
  </g>
);

/** A tag on the value axis centred on `y`; its fill comes from `fill` or the surrounding group's CSS. */
const AxisTag: React.FC<{ f: Frame; y: number; text: string; fill?: string; textClassName?: string }> = ({ f, y, text, fill, textClassName }) => (
  <>
    <rect x={f.width - PAD.right + 2} y={y - TAG_HEIGHT / 2} width={PAD.right - 4} height={TAG_HEIGHT} rx={4} fill={fill} />
    <text className={textClassName} x={f.width - PAD.right / 2} y={y + 4} textAnchor="middle">{text}</text>
  </>
);

/** The shown minute's value as a tag on the price axis, with a faint line across to it. */
const PriceTag: React.FC<{ f: Frame; value: number; colour: string; label: string }> = ({ f, value, colour, label }) => {
  const y = f.y(value);
  return (
    <g>
      <line x1={PAD.left} x2={f.width - PAD.right} y1={y} y2={y} stroke={colour} strokeDasharray="2 3" strokeOpacity={0.6} />
      <AxisTag f={f} y={y} text={label} fill={colour} textClassName="replay-chart__tag" />
    </g>
  );
};

const evenTicks = (low: number, high: number, count: number) => Array.from({ length: count + 1 }, (_, i) => low + ((high - low) * i) / count);

/** Widens [low, high] by a share of its span (at least `minimum`), so marks never touch the edges. */
function padded(low: number, high: number, share: number, minimum: number): [number, number] {
  const pad = Math.max((high - low) * share, minimum);
  return [low - pad, high + pad];
}

const ChartBox: React.FC<{ label: string; height: number; children: (width: number, pointer: Pointer | null) => React.ReactNode }> = ({ label, height, children }) => {
  const [width, ref] = useElementWidth();
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const track = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setPointer({ x: event.clientX - box.left, y: event.clientY - box.top });
  };
  return (
    <div ref={ref} className="replay-chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} onMouseMove={track} onMouseLeave={() => setPointer(null)}>
          {children(width, pointer)}
        </svg>
      )}
    </div>
  );
};

/** The CPR's three lines (top, pivot, bottom) dotted in blue, R1–R2 dashed in red and S1–S2 dashed in green. */
const LEVEL_LINES: { key: keyof CprLevels; colour: string; dash: string }[] = [
  { key: 'r2', colour: 'var(--loss)', dash: '6 4' },
  { key: 'r1', colour: 'var(--loss)', dash: '6 4' },
  { key: 'tc', colour: 'var(--blue)', dash: '2 3' },
  { key: 'pivot', colour: 'var(--blue)', dash: '2 3' },
  { key: 'bc', colour: 'var(--blue)', dash: '2 3' },
  { key: 's1', colour: 'var(--profit)', dash: '6 4' },
  { key: 's2', colour: 'var(--profit)', dash: '6 4' },
];

const PivotLevels: React.FC<{ f: Frame; levels: CprLevels }> = ({ f, levels }) => (
  <g className="replay-chart__levels">
    {LEVEL_LINES.map(({ key, colour, dash }) => (
      <line key={key} x1={PAD.left} x2={f.width - PAD.right} y1={f.y(levels[key])} y2={f.y(levels[key])} stroke={colour} strokeOpacity={0.7} strokeDasharray={dash} />
    ))}
  </g>
);

/**
 * The index's 1-minute candles up to the shown minute, the previous close, the CPR and pivot levels from the previous
 * session, and the player's entries (dots) and exits (crosses).
 */
export const IndexChart: React.FC<{ day: ReplayDay; minute: number; marks: ChartMark[]; height: number }> = ({ day, minute, marks, height }) => {
  const shown = day.index.slice(0, minute + 1);
  const lows = shown.map((m) => m[2]), highs = shown.map((m) => m[1]);
  if (day.prevClose != null) { lows.push(day.prevClose); highs.push(day.prevClose); }
  // Every level, from S2 to R2, is in view from the first minute.
  const levels = day.prevDay ? cprLevels(day.prevDay) : null;
  if (levels) { lows.push(levels.s2); highs.push(levels.r2); }
  const [low, high] = padded(Math.min(...lows), Math.max(...highs), 0.08, 5);
  const [open, , , close] = day.index[minute];
  return (
    <ChartBox label={`${day.label} 1-minute candles`} height={height}>
      {(width, pointer) => {
        const f = frame(width, height, day, low, high);
        const body = Math.max(1, f.slot * 0.85);
        return (
          <>
            <Axes f={f} ticks={evenTicks(low, high, 5)} label={(v) => Math.round(v).toString()} />
            {levels && <PivotLevels f={f} levels={levels} />}
            {day.prevClose != null && (
              <g className="replay-chart__reference">
                <line x1={PAD.left} x2={width - PAD.right} y1={f.y(day.prevClose)} y2={f.y(day.prevClose)} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                <text x={width - PAD.right - 6} y={f.y(day.prevClose) - 6} textAnchor="end">Prev close {formatAmount(day.prevClose)}</text>
              </g>
            )}
            {shown.map(([o, top, bottom, c], m) => {
              const colour = c >= o ? 'var(--profit)' : 'var(--loss)';
              const y = f.y(Math.max(o, c));
              return (
                <g key={m}>
                  <line x1={f.x(m)} x2={f.x(m)} y1={f.y(top)} y2={f.y(bottom)} stroke={colour} />
                  <rect x={f.x(m) - body / 2} y={y} width={body} height={Math.max(1, f.y(Math.min(o, c)) - y)} rx={Math.min(1.5, body / 4)} fill={colour} />
                </g>
              );
            })}
            <PriceTag f={f} value={close} colour={close >= open ? 'var(--profit)' : 'var(--loss)'} label={close.toFixed(1)} />
            {marks.filter((mark) => mark.minute <= minute).map((mark) => {
              const [, top, bottom] = day.index[mark.minute];
              const x = f.x(mark.minute);
              const y = mark.optionType === OptionType.CE ? f.y(bottom) + 12 : f.y(top) - 12;
              const colour = OPTION_COLOUR[mark.optionType];
              return mark.entry
                ? <circle key={`in-${mark.minute}`} cx={x} cy={y} r={5} fill={colour} stroke="var(--card-bg-solid)" strokeWidth={2} />
                : <path key={`out-${mark.minute}`} d={`M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`} stroke={colour} strokeWidth={2.5} strokeLinecap="round" />;
            })}
            <Crosshair f={f} pointer={pointer} label={formatAmount} />
          </>
        );
      }}
    </ChartBox>
  );
};

const seriesPoints = (series: OptionMinute[], minute: number, f: Frame) =>
  series.slice(0, minute + 1).flatMap((m, i) => (m ? [[f.x(i), f.y(m[1])] as const] : []));

/** A premium's line with a faint shade beneath it down to the chart's floor. */
const ShadedLine: React.FC<{ points: (readonly [number, number])[]; floor: number; colour: string }> = ({ points, floor, colour }) => {
  if (!points.length) return null;
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${points[0][0]},${floor} ${line} ${points[points.length - 1][0]},${floor}`;
  return (
    <>
      <polygon points={area} fill={colour} fillOpacity={0.07} />
      <polyline points={line} fill="none" stroke={colour} strokeWidth={1.75} strokeLinejoin="round" />
    </>
  );
};

/** One strike's call and put premiums up to the shown minute, with the entry price of a position in it. */
export const PremiumChart: React.FC<{ day: ReplayDay; minute: number; strike: number; entryPrice: number | null; entryType: OptionTypeId | null; height: number }> = ({
  day, minute, strike, entryPrice, entryType, height,
}) => {
  const calls = day.calls[strike] ?? [], puts = day.puts[strike] ?? [];
  const values = [...calls.slice(0, minute + 1), ...puts.slice(0, minute + 1)].flatMap((m) => (m ? [m[1]] : []));
  if (entryPrice != null) values.push(entryPrice);
  if (!values.length) return <div className="replay-chart" style={{ height }} />;
  const [low, high] = padded(Math.min(...values), Math.max(...values), 0.1, 2);
  return (
    <ChartBox label={`${strike} call and put premiums`} height={height}>
      {(width, pointer) => {
        const f = frame(width, height, day, low, high);
        const floor = f.y(low);
        const lastCall = calls[minute]?.[1], lastPut = puts[minute]?.[1];
        return (
          <>
            <Axes f={f} ticks={evenTicks(low, high, 3)} label={(v) => v.toFixed(0)} />
            <ShadedLine points={seriesPoints(calls, minute, f)} floor={floor} colour={OPTION_COLOUR[OptionType.CE]} />
            <ShadedLine points={seriesPoints(puts, minute, f)} floor={floor} colour={OPTION_COLOUR[OptionType.PE]} />
            {entryPrice != null && entryType && (
              <g className="replay-chart__reference">
                <line x1={PAD.left} x2={width - PAD.right} y1={f.y(entryPrice)} y2={f.y(entryPrice)} stroke={OPTION_COLOUR[entryType]} strokeDasharray="3 3" />
                <text x={width - PAD.right - 6} y={f.y(entryPrice) - 6} textAnchor="end">Your entry {formatAmount(entryPrice)}</text>
              </g>
            )}
            {lastCall != null && <PriceTag f={f} value={lastCall} colour={OPTION_COLOUR[OptionType.CE]} label={lastCall.toFixed(1)} />}
            {lastPut != null && <PriceTag f={f} value={lastPut} colour={OPTION_COLOUR[OptionType.PE]} label={lastPut.toFixed(1)} />}
            <Crosshair f={f} pointer={pointer} label={formatAmount} />
          </>
        );
      }}
    </ChartBox>
  );
};

/**
 * Near-the-money OI: bars of the 5-minute flow (% of OI, put adds minus call adds) and a line of the same since the
 * open (lakh, on its own scale), up to the shown minute.
 */
export const OiFlowChart: React.FC<{ day: ReplayDay; minute: number; flow: (number | null)[]; sinceOpen: number[]; height: number }> = ({
  day, minute, flow, sinceOpen, height,
}) => {
  const bars = flow.slice(0, minute + 1).map((v) => v ?? 0);
  const line = sinceOpen.slice(0, minute + 1);
  const reach = Math.max(0.5, ...bars.map(Math.abs));
  const lineReach = Math.max(0.01, ...line.map(Math.abs));
  return (
    <ChartBox label="Near-the-money OI flow" height={height}>
      {(width, pointer) => {
        const f = frame(width, height, day, -reach, reach);
        const lineF = frame(width, height, day, -lineReach, lineReach);
        const body = Math.max(1, f.slot * 0.7);
        return (
          <>
            <Axes f={f} ticks={[-reach, 0, reach]} label={(v) => `${v.toFixed(1)}%`} />
            {bars.map((v, m) => (
              <rect key={m} x={f.x(m) - body / 2} y={Math.min(f.y(0), f.y(v))} width={body} height={Math.abs(f.y(v) - f.y(0))} rx={Math.min(1, body / 4)}
                fill={v >= 0 ? 'var(--profit)' : 'var(--loss)'} fillOpacity={0.85} />
            ))}
            <polyline points={line.map((v, m) => `${lineF.x(m)},${lineF.y(v)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" />
            <Crosshair f={f} pointer={pointer} label={(v) => `${v.toFixed(2)}%`} />
          </>
        );
      }}
    </ChartBox>
  );
};
