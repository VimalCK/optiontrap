import { describe, it, expect } from 'vitest';
import { dayReadingItems } from './dayReadings';
import { DayLean } from '../../../shared/analysisEnums.js';

describe('dayReadingItems', () => {
  it('labels each reading and says which way it points', () => {
    const items = dayReadingItems({ since: '12:14', dayMove: 153, recentMove: 149, putOiAdded: 98e5, callOiAdded: -93e5, pcrFrom: 0.95, pcrTo: 1.16 });
    expect(items).toEqual([
      { label: 'Spot today', value: '+153', note: 'since 12:14', lean: DayLean.Bullish },
      { label: 'Last 30 min', value: '+149', lean: DayLean.Bullish },
      { label: 'OI near spot', value: 'Put +98.0L · Call −93.0L', lean: DayLean.Bullish },
      { label: 'PCR', value: '0.95 → 1.16', lean: DayLean.Bullish },
    ]);
  });

  it('reads calls added faster than puts, a falling PCR and a falling spot as bearish', () => {
    const items = dayReadingItems({ since: '09:15', dayMove: -40, recentMove: 0, putOiAdded: 1e5, callOiAdded: 5e5, pcrFrom: 1.2, pcrTo: 1.0 });
    expect(items.map((item) => item.lean)).toEqual([DayLean.Bearish, DayLean.Neutral, DayLean.Bearish, DayLean.Bearish]);
  });
});
