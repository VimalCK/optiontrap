import type { DayReadings } from '@/services/sellStrategy';
import { DayLean, type DayLeanId } from '../../../shared/analysisEnums.js';

/** One reading behind the day's lean, as the card shows it: a label, its value and which way it points. */
export interface DayReadingItem {
  label: string;
  value: string;
  note?: string;
  lean: DayLeanId;
}

const signedPoints = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(0)}`;

const signedLakhs = (value: number): string => `${value >= 0 ? '+' : '−'}${(Math.abs(value) / 1e5).toFixed(1)}L`;

/** Up is bullish, down bearish, no change neutral. */
const leanOf = (change: number): DayLeanId => (change > 0 ? DayLean.Bullish : change < 0 ? DayLean.Bearish : DayLean.Neutral);

/**
 * The four readings the lean comes from. Puts added faster than calls near spot
 * lean bullish (writers defend the downside), and so does a rising PCR.
 */
export function dayReadingItems(readings: DayReadings): DayReadingItem[] {
  return [
    { label: 'Spot today', value: signedPoints(readings.dayMove), note: `since ${readings.since}`, lean: leanOf(readings.dayMove) },
    { label: 'Last 30 min', value: signedPoints(readings.recentMove), lean: leanOf(readings.recentMove) },
    {
      label: 'OI near spot',
      value: `Put ${signedLakhs(readings.putOiAdded)} · Call ${signedLakhs(readings.callOiAdded)}`,
      lean: leanOf(readings.putOiAdded - readings.callOiAdded),
    },
    { label: 'PCR', value: `${readings.pcrFrom.toFixed(2)} → ${readings.pcrTo.toFixed(2)}`, lean: leanOf(readings.pcrTo - readings.pcrFrom) },
  ];
}
