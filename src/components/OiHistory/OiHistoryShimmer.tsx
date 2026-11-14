import React from 'react';
import Shimmer, { ShimmerGroup, ShimmerTableRows, shimmerKeys } from '@/components/Shimmer/Shimmer';
import { ShimmerShape } from '@/utils/uiEnums';
import { FUTURES_CONTEXT_TITLE } from './FuturesContext';
import { OI_SNAPSHOT_TITLE } from './OiSnapshotTable';

/** Day buttons in the placeholder date bar. */
const PLACEHOLDER_DAYS = 20;
/** Futures Context: a row per futures month; Month, Close, Price, OI, OI change, Volume, Signal. */
const FUTURES_ROWS = 3;
const FUTURES_COLUMNS = 7;
/** OI Snapshot: CE pattern, two CE expiries, the strike, two PE expiries, PE pattern. */
const SNAPSHOT_ROWS = 10;
const SNAPSHOT_COLUMNS = 7;

/** A titled OI History table card in outline: the real title, a shimmering subtitle and rows. */
const TableCardShimmer: React.FC<{ title: string; rows: number; columns: number }> = ({ title, rows, columns }) => (
  <div className="oi-history__table-wrap card">
    <div className="oi-history__table-header">
      <div className="oi-history__table-header-left">
        <div>
          <div className="oi-history__table-title">{title}</div>
          <div className="oi-history__table-subtitle"><Shimmer width="14em" /></div>
        </div>
      </div>
    </div>
    <div className="oi-history__table-scroll">
      <table className="oi-history__table">
        <tbody><ShimmerTableRows rows={rows} columns={columns} /></tbody>
      </table>
    </div>
  </div>
);

/**
 * OI History in outline while its data loads, in the page's order: the date bar, Futures Context, the OI Snapshot
 * grid and the selected strike's chart card. The grid's real headings come from the expiries the data brings.
 */
const OiHistoryShimmer: React.FC = () => (
  <ShimmerGroup label="Loading OI history" className="oi-history__shimmer">
    <div className="oi-history__date-bar">
      <div className="oi-history__date-group">
        <span className="oi-history__date-group-label"><Shimmer width="2.5em" /></span>
        <div className="oi-history__date-group-days">
          {shimmerKeys(PLACEHOLDER_DAYS).map((day) => <Shimmer key={day} shape={ShimmerShape.Block} className="oi-history__date-shimmer" />)}
        </div>
      </div>
    </div>
    <TableCardShimmer title={FUTURES_CONTEXT_TITLE} rows={FUTURES_ROWS} columns={FUTURES_COLUMNS} />
    <TableCardShimmer title={OI_SNAPSHOT_TITLE} rows={SNAPSHOT_ROWS} columns={SNAPSHOT_COLUMNS} />
    <div className="oi-history__chart-wrap card">
      <div className="oi-history__chart-header">
        <span className="oi-history__chart-title"><Shimmer width="6em" /></span>
      </div>
      <Shimmer shape={ShimmerShape.Block} className="oi-history__chart-shimmer" />
    </div>
  </ShimmerGroup>
);

export default OiHistoryShimmer;
