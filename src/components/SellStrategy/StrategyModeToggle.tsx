import React from 'react';
import SegmentedControl, { type SegmentOption } from '@/components/SegmentedControl/SegmentedControl';
import { Tone } from '@/utils/uiEnums';
import { STRATEGY_MODES, StrategyMode, type StrategyModeId } from '../../../shared/appEnums.js';

/** Sell setups show red when chosen, buy setups green, the rest in the accent colour. */
const MODE_TONES: Partial<Record<StrategyModeId, SegmentOption<StrategyModeId>['tone']>> = {
  [StrategyMode.Sell]: Tone.Negative,
  [StrategyMode.Buy]: Tone.Positive,
};

const OPTIONS: SegmentOption<StrategyModeId>[] = STRATEGY_MODES.map(({ id, label }) => ({ id, label, tone: MODE_TONES[id] }));

const StrategyModeToggle: React.FC<{ mode: StrategyModeId; onChange: (mode: StrategyModeId) => void }> = ({ mode, onChange }) => (
  <SegmentedControl options={OPTIONS} value={mode} onChange={onChange} label="Strategy view" />
);

export default StrategyModeToggle;
