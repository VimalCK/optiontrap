import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

vi.mock('./db.js', () => ({
  getExportColumns: vi.fn(),
  getExportPage: vi.fn(),
  findLongTextCell: vi.fn(),
}));

const db = await import('./db.js');
const {
  EXCEL_CELL_MAX_LENGTH, EXPORT_PAGE_SIZE, TABLE_EXPORTS, exportFileName, exportRefusal, findTableExport, tableExportInfos, writeTableWorkbook,
} = await import('./tableExports.js');
const { ExportTable } = await import('../shared/appEnums.js');

const COLUMNS = [{ name: 'id', isText: false }, { name: 'timestamp', isText: false }, { name: 'data', isText: true }];
const TABLE = { id: ExportTable.OiSnapshots, table: 'oi_snapshots', key: 'id', label: 'OI snapshots', description: '', fileName: 'oi-snapshots' };

/** The table holds `rows`; the mocked reads page them the way the database does. */
function tableHolds(rows) {
  vi.mocked(db.getExportColumns).mockResolvedValue(COLUMNS);
  vi.mocked(db.getExportPage).mockImplementation(async (_source, _columns, afterKey, limit) =>
    rows.filter((row) => afterKey === null || row.id > afterKey).slice(0, limit));
}

/** The sheet's rows as arrays, header first, read back from the written file. */
async function writtenSheet() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  await writeTableWorkbook(TABLE, stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  const sheet = workbook.worksheets[0];
  const values = [];
  sheet.eachRow((row) => values.push(row.values.slice(1)));
  return { name: sheet.name, values };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeTableWorkbook', () => {
  it("writes the table's columns as the header, then every row in key order", async () => {
    tableHolds([
      { id: 1, timestamp: 1763350800000, data: '{"256265":1}' },
      { id: 2, timestamp: 1763351400000, data: '{"256265":2}' },
    ]);
    const { name, values } = await writtenSheet();
    expect(name).toBe('OI snapshots');
    expect(values).toEqual([['id', 'timestamp', 'data'], [1, 1763350800000, '{"256265":1}'], [2, 1763351400000, '{"256265":2}']]);
    expect(db.getExportColumns).toHaveBeenCalledWith('oi_snapshots');
  });

  it('reads a page at a time, each after the last key of the one before', async () => {
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 1 }, (_, i) => ({ id: i + 1, timestamp: i, data: '{}' }));
    tableHolds(rows);
    const { values } = await writtenSheet();
    expect(values).toHaveLength(rows.length + 1);
    expect(vi.mocked(db.getExportPage).mock.calls.map((call) => call[2])).toEqual([null, EXPORT_PAGE_SIZE]);
  });

  it('keeps a cell as long as Excel allows whole', async () => {
    tableHolds([{ id: 1, timestamp: 1, data: 'x'.repeat(EXCEL_CELL_MAX_LENGTH) }]);
    expect((await writtenSheet()).values[1][2]).toHaveLength(EXCEL_CELL_MAX_LENGTH);
  });

  it('writes just the header for an empty table', async () => {
    tableHolds([]);
    expect((await writtenSheet()).values).toEqual([['id', 'timestamp', 'data']]);
  });
});

describe('exportRefusal', () => {
  it('names the row and column too long for Excel', async () => {
    tableHolds([]);
    vi.mocked(db.findLongTextCell).mockResolvedValueOnce({ key: 94, column: 'contracts' });
    expect(await exportRefusal(TABLE)).toBe(
      "OI snapshots: the contracts of the row with id 94 is longer than Excel's 32,767 characters per cell, so the table can't be exported whole.",
    );
    expect(db.findLongTextCell).toHaveBeenCalledWith(TABLE, COLUMNS, EXCEL_CELL_MAX_LENGTH);
  });

  it('is null when every cell fits', async () => {
    tableHolds([]);
    vi.mocked(db.findLongTextCell).mockResolvedValueOnce(null);
    expect(await exportRefusal(TABLE)).toBeNull();
  });
});

describe('the export list', () => {
  it('names the file by the IST date: 23:00 UTC is already the next day in India', () => {
    expect(exportFileName(TABLE, new Date('2026-11-13T23:00:00Z'))).toBe('oi-snapshots-2026-11-14.xlsx'); // 04:30 IST
  });

  it('finds an export by its id, and nothing for any other', () => {
    expect(findTableExport(ExportTable.OiSnapshots)?.table).toBe('oi_snapshots');
    expect(findTableExport('users')).toBeNull();
  });

  it('lists each export by id, label and description only, so table names stay on the server', () => {
    expect(tableExportInfos()).toEqual(TABLE_EXPORTS.map(({ id, label, description }) => ({ id, label, description })));
  });

  it('has one export per ExportTable member', () => {
    expect(TABLE_EXPORTS.map((table) => table.id).sort()).toEqual(Object.values(ExportTable).sort());
  });
});
