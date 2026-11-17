import ExcelJS from 'exceljs';
import { ExportTable } from '../shared/appEnums.js';
import { marketDate } from '../shared/marketTime.js';
import { findLongTextCell, getExportColumns, getExportPage } from './db.js';

/** Excel keeps at most this many characters in one cell. */
export const EXCEL_CELL_MAX_LENGTH = 32767;

/** Rows read from the database at a time, so a large table never sits in memory whole. */
export const EXPORT_PAGE_SIZE = 500;

/**
 * A table an admin can download (Admin → Data). Every column is exported, named as in the table, and rows are
 * read in `key` order; `key` must be unique and indexed (the primary key).
 * @typedef {object} TableExport
 * @property {import('../shared/appEnums.js').ExportTableId} id
 * @property {string} table
 * @property {string} key
 * @property {string} label
 * @property {string} description
 * @property {string} fileName  the file's name before its IST date
 */

/** Add a table by adding it here (and its member to ExportTable). @type {TableExport[]} */
export const TABLE_EXPORTS = [
  {
    id: ExportTable.OiSnapshots,
    table: 'oi_snapshots',
    key: 'id',
    label: 'OI snapshots',
    description: 'Every option-chain OI snapshot the table holds, one row per snapshot with its maps as JSON text. The nightly purge keeps only the latest trading day.',
    fileName: 'oi-snapshots',
  },
  {
    id: ExportTable.AlgoTrades,
    table: 'algo_trades',
    key: 'id',
    label: 'Automated trades',
    description: "Every user's automated trades: strategy, setup, side, entry and exit prices, stage, exit rule and reason, and charges.",
    fileName: 'algo-trades',
  },
  {
    id: ExportTable.AlgoTradeEvents,
    table: 'algo_trade_events',
    key: 'id',
    label: 'Automated trade events',
    description: "Each automated trade's steps (selected, validated, rejected, executed, closed) with their time and details as JSON text.",
    fileName: 'algo-trade-events',
  },
  {
    id: ExportTable.Positions,
    table: 'positions',
    key: 'id',
    label: 'Paper positions',
    description: "Every user's paper positions, manual and automated, with entry and exit prices and times, and charges.",
    fileName: 'positions',
  },
];

/** What the Admin page lists of each export. */
export const tableExportInfos = (/** @type {TableExport[]} */ exports = TABLE_EXPORTS) =>
  exports.map(({ id, label, description }) => ({ id, label, description }));

export const findTableExport = (/** @type {unknown} */ id, /** @type {TableExport[]} */ exports = TABLE_EXPORTS) =>
  exports.find((table) => table.id === id) ?? null;

/** The download's name: the table's file name and today's IST date. */
export const exportFileName = (/** @type {TableExport} */ table, now = new Date()) => `${table.fileName}-${marketDate(now)}.xlsx`;

/**
 * Why the table can't be written to a spreadsheet whole, or null when it can.
 * @param {TableExport} table
 */
export async function exportRefusal(table) {
  const columns = await getExportColumns(table.table);
  const cell = await findLongTextCell(table, columns, EXCEL_CELL_MAX_LENGTH);
  if (!cell) return null;
  return `${table.label}: the ${cell.column} of the row with ${table.key} ${cell.key} is longer than Excel's ${EXCEL_CELL_MAX_LENGTH.toLocaleString('en-IN')} characters per cell, so the table can't be exported whole.`;
}

/**
 * Writes every row of the table into an .xlsx on `stream`, one page at a time, as each page is read.
 * @param {TableExport} table
 * @param {import('stream').Writable} stream
 */
export async function writeTableWorkbook(table, stream) {
  const columns = await getExportColumns(table.table);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: false, useSharedStrings: false });
  const sheet = workbook.addWorksheet(table.label);
  sheet.columns = columns.map(({ name }) => ({ header: name, key: name }));
  /** @type {unknown} */
  let afterKey = null;
  for (;;) {
    const page = await getExportPage(table, columns, afterKey, EXPORT_PAGE_SIZE);
    for (const row of page) sheet.addRow(row).commit();
    if (page.length < EXPORT_PAGE_SIZE) break;
    afterKey = page[page.length - 1][table.key];
  }
  sheet.commit();
  await workbook.commit();
}
