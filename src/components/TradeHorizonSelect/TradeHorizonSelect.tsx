/**
 * Screens keep the choice with useTradeHorizon, so they all start from the last one picked.
 */
import React from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { HORIZONS, type HorizonId } from '../../../shared/tradeEnums.js';

const OPTIONS = HORIZONS.map((h) => ({ value: h.id, label: h.label }));
const TITLE = 'Intraday trades are placed in market hours and squared off the same day; positional trades can be placed any time and fill in market hours';

/** The options are the horizons, so the fallback is never used. */
const horizonOf = (value: string | number, fallback: HorizonId): HorizonId => HORIZONS.find((h) => h.id === value)?.id ?? fallback;

const TradeHorizonSelect: React.FC<{ value: HorizonId; onChange: (horizon: HorizonId) => void }> = ({ value, onChange }) => (
  <span title={TITLE}>
    <AppSelect value={value} options={OPTIONS} onChange={(v) => onChange(horizonOf(v, value))} />
  </span>
);

export default TradeHorizonSelect;
