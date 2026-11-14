import React from 'react';
import './Shimmer.css';
import { ShimmerShape, type ShimmerShapeId } from '@/utils/uiEnums';

type ShimmerSize = number | string;

export interface ShimmerProps {
  /** Text sits in a line and scales with its font; Block fills its box; Circle needs a width and height. */
  shape?: ShimmerShapeId;
  /** A number is pixels; a string is any CSS length, e.g. "60%" or "4em". */
  width?: ShimmerSize;
  height?: ShimmerSize;
  className?: string;
}

/** A placeholder in the shape of content that is still loading. Hidden from screen readers: a ShimmerGroup or the page announces the load. */
const Shimmer: React.FC<ShimmerProps> = ({ shape = ShimmerShape.Text, width, height, className }) => (
  <span
    className={['shimmer', `shimmer--${shape.toLowerCase()}`, className].filter(Boolean).join(' ')}
    style={{ width, height }}
    aria-hidden="true"
  />
);

/** A text value, or a line-shaped placeholder of `width` while it loads. */
export const ShimmerText: React.FC<{ loading: boolean; width?: ShimmerSize; children: React.ReactNode }> = ({ loading, width, children }) =>
  loading ? <Shimmer width={width} /> : <>{children}</>;

/** Keys for `count` repeated placeholders, e.g. the rows of a list still loading. */
export const shimmerKeys = (count: number) => Array.from({ length: count }, (_, index) => index);

/** Widths the cells of a placeholder row cycle through, so the rows look like text of different lengths. */
const CELL_WIDTHS = ['75%', '45%', '60%', '50%', '65%'];

/**
 * Placeholder rows for a table's body while it loads, under the table's real header. `cellClassName` is for a
 * table that styles its cells by class rather than `td`, so the placeholder rows get the same padding.
 */
export const ShimmerTableRows: React.FC<{ rows: number; columns: number; cellClassName?: string }> = ({ rows, columns, cellClassName }) => (
  <>
    {shimmerKeys(rows).map((row) => (
      <tr key={row} className="shimmer-row">
        {shimmerKeys(columns).map((column) => (
          <td key={column} className={cellClassName}><Shimmer width={CELL_WIDTHS[column % CELL_WIDTHS.length]} /></td>
        ))}
      </tr>
    ))}
  </>
);

/** The placeholders standing in for one area, announced once to screen readers by `label`. */
export const ShimmerGroup: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className, children }) => (
  <div className={['shimmer-group', className].filter(Boolean).join(' ')} role="status" aria-busy="true">
    <span className="shimmer-group__label">{label}</span>
    {children}
  </div>
);

export default Shimmer;
