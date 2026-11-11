/**
 * TradeHorizonSelect — the trade type picker every screen that places manual
 * trades shows: Intraday (squared off the same day, placed in market hours) or
 * Positional (held over days, placed at any time, filled in market hours).
 * Options come from shared/horizons.js; screens keep the choice with
 * useTradeHorizon, so they all start from the last one picked. Each screen
 * labels it ("Trade") in its own toolbar style.
 */
import React from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { HORIZONS, type HorizonId } from '../../../shared/horizons.js';

const OPTIONS = HORIZONS.map((h) => ({ value: h.id, label: h.label }));
const TITLE = 'Intraday trades are placed in market hours and squared off the same day; positional trades can be placed any time and fill in market hours';

/** The horizon an option value stands for (the options are the horizons, so it is always one). */
const horizonOf = (value: string | number, fallback: HorizonId): HorizonId => HORIZONS.find((h) => h.id === Number(value))?.id ?? fallback;

const TradeHorizonSelect: React.FC<{ value: HorizonId; onChange: (horizon: HorizonId) => void }> = ({ value, onChange }) => (
  <span title={TITLE}>
    <AppSelect value={value} options={OPTIONS} onChange={(v) => onChange(horizonOf(v, value))} />
  </span>
);

export default TradeHorizonSelect;
