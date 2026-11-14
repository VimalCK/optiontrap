import pg from 'pg';
import { firstRow, rows } from './pool.js';

/**
 * A table read for export: its name and the unique, indexed column it is paged by (its primary key).
 * @typedef {{ table: string, key: string }} ExportSource
 * @typedef {{ name: string, isText: boolean }} ExportColumn
 */

const { escapeIdentifier } = pg;

/** Column types stored as text, so a value can outgrow a spreadsheet cell. */
const TEXT_TYPES = ['text', 'character varying', 'json', 'jsonb'];

/**
 * The table's columns in table order, and which hold text. Read from the catalog, so a column a migration adds
 * is exported without a code change.
 * @param {string} table
 * @returns {Promise<ExportColumn[]>}
 */
export async function getExportColumns(table) {
  const result = await rows(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return result.map((row) => ({ name: row.column_name, isText: TEXT_TYPES.includes(row.data_type) }));
}

/**
 * Up to `limit` rows after `afterKey` (from the start when null), in key order, every column as stored. Keyset
 * paging on the key's index reads one index range per page, however large the table.
 * @param {ExportSource} source
 * @param {ExportColumn[]} columns
 * @param {unknown} afterKey
 * @param {number} limit
 */
export async function getExportPage({ table, key }, columns, afterKey, limit) {
  const keyColumn = escapeIdentifier(key);
  const from = `SELECT ${columns.map((column) => escapeIdentifier(column.name)).join(', ')} FROM ${escapeIdentifier(table)}`;
  if (afterKey === null) return rows(`${from} ORDER BY ${keyColumn} LIMIT $1`, [limit]);
  return rows(`${from} WHERE ${keyColumn} > $1 ORDER BY ${keyColumn} LIMIT $2`, [afterKey, limit]);
}

/**
 * The first row (in key order) with a text value longer than `maxLength` characters, and that column; null when
 * none. Reads every row, as the export it guards does.
 * @param {ExportSource} source
 * @param {ExportColumn[]} columns
 * @param {number} maxLength
 * @returns {Promise<{ key: unknown, column: string } | null>}
 */
export async function findLongTextCell({ table, key }, columns, maxLength) {
  const textColumns = columns.filter((column) => column.isText);
  if (textColumns.length === 0) return null;
  const cells = textColumns.map((column, index) => `($${index + 2}, ${escapeIdentifier(column.name)}::text)`).join(', ');
  const keyColumn = escapeIdentifier(key);
  const row = await firstRow(
    `SELECT t.${keyColumn} AS key, cell.name AS column
     FROM ${escapeIdentifier(table)} t, LATERAL (VALUES ${cells}) AS cell(name, value)
     WHERE length(cell.value) > $1
     ORDER BY t.${keyColumn}
     LIMIT 1`,
    [maxLength, ...textColumns.map((column) => column.name)],
  );
  return row ? { key: row.key, column: row.column } : null;
}
