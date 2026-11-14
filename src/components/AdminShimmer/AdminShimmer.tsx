import React from 'react';
import Shimmer, { shimmerKeys } from '@/components/Shimmer/Shimmer';
import { ShimmerShape } from '@/utils/uiEnums';
import './AdminShimmer.css';

/** Placeholder rows under an admin table's real head (Users, Feedback). */
export const AdminTableRowsShimmer: React.FC<{ rows: number; columns: number }> = ({ rows, columns }) => (
  <>
    {shimmerKeys(rows).map((row) => (
      <div key={row} className="admin-row">
        <div className="admin-table__row">
          {shimmerKeys(columns).map((column) => <span key={column} className="admin-cell"><Shimmer width="70%" /></span>)}
        </div>
      </div>
    ))}
  </>
);

/** Placeholder service rows (icon, name, detail, badge), as on Diagnostics and Data. */
export const ServiceRowsShimmer: React.FC<{ rows: number }> = ({ rows }) => (
  <>
    {shimmerKeys(rows).map((row) => (
      <div key={row} className="hx-service">
        <Shimmer shape={ShimmerShape.Block} className="admin-shimmer__icon" />
        <div className="hx-service__body">
          <strong><Shimmer width="8em" /></strong>
          <small><Shimmer width="16em" /></small>
        </div>
        <Shimmer shape={ShimmerShape.Block} className="admin-shimmer__badge" />
      </div>
    ))}
  </>
);
