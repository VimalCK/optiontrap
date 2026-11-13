import React from 'react';
import { BellIcon } from '@/components/icons/Icons';
import type { Zone } from '../../../shared/stockSetups.js';
import { LevelSide, type LevelSideId } from '../../../shared/analysisEnums.js';
import { PriceAlertCondition, type PriceAlertConditionId } from '../../../shared/appEnums.js';
import { rupees, signedPct, zoneHistoryText } from './setupDetails';

export type SetAlert = (condition: PriceAlertConditionId, value: number, note: string) => void;

const Strength: React.FC<{ value: 1 | 2 | 3 }> = ({ value }) => (
  <span className="wl-sz-strength" title={`Strength ${value} of 3`} aria-label={`Strength ${value} of 3`}>
    {[1, 2, 3].map((n) => <span key={n} className={n <= value ? 'wl-sz-strength__bar wl-sz-strength__bar--on' : 'wl-sz-strength__bar'} />)}
  </span>
);

/** An alert at the zone's near edge: a support's top (price falling into it), a resistance's bottom (rising into it). */
const ZoneAlertButton: React.FC<{ zone: Zone; onSetAlert: SetAlert }> = ({ zone, onSetAlert }) => {
  const support = zone.side === LevelSide.Support;
  const range = `${rupees(zone.low)}–${rupees(zone.high)}`;
  return (
    <button
      type="button"
      className="wl-alert-btn"
      onClick={() => onSetAlert(
        support ? PriceAlertCondition.Below : PriceAlertCondition.Above,
        Number((support ? zone.high : zone.low).toFixed(2)),
        `${support ? 'Support' : 'Resistance'} zone ${range} (${zone.reasons.join(', ')})`,
      )}
      title={support ? 'Alert when price falls into this zone' : 'Alert when price rises into this zone'}
      aria-label={`Set alert at ${support ? 'support' : 'resistance'} ${range}`}
    >
      <BellIcon size={14} />
    </button>
  );
};

const ZoneRow: React.FC<{ zone: Zone; price: number; onSetAlert?: SetAlert }> = ({ zone, price, onSetAlert }) => {
  const inside = zone.low <= price && price <= zone.high;
  return (
    <div className={`wl-sz-zone wl-sz-zone--${zone.side.toLowerCase()}`}>
      <div className="wl-sz-zone__main">
        <span className="wl-sz-zone__range">{rupees(zone.low)} – {rupees(zone.high)}</span>
        {inside ? <span className="wl-sz-tag">Price here</span> : <span className="wl-sz-zone__dist">{signedPct(zone.distancePct)}</span>}
        <Strength value={zone.strength} />
        {onSetAlert && <ZoneAlertButton zone={zone} onSetAlert={onSetAlert} />}
      </div>
      <div className="wl-sz-zone__meta">
        <span className="wl-sz-zone__history">{zoneHistoryText(zone)}</span>
        <span className="wl-sz-zone__why">
          {zone.reasons.map((reason) => <span key={reason} className="wl-sz-reason">{reason}</span>)}
        </span>
      </div>
    </div>
  );
};

/** One side's zones (support or resistance) with a heading, or `empty` when there are none. */
const ZoneList: React.FC<{ title: string; side: LevelSideId; zones: Zone[]; price: number; empty: string; onSetAlert?: SetAlert }> = ({
  title, side, zones, price, empty, onSetAlert,
}) => (
  <section className="wl-sz-section">
    <h4><i className={`wl-sz-dot wl-sz-dot--${side.toLowerCase()}`} />{title}</h4>
    {zones.length
      ? <div className="wl-sz-zones">{zones.map((zone) => <ZoneRow key={`${zone.side}-${zone.low}`} zone={zone} price={price} onSetAlert={onSetAlert} />)}</div>
      : <p className="wl-sz-empty">{empty}</p>}
  </section>
);

export default ZoneList;
