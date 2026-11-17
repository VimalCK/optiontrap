import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableExportPicker, fileSizeLabel, type SavedFile } from './AdminData';
import { ExportTable } from '../../shared/appEnums.js';

const tables = [
  { id: ExportTable.OiSnapshots, label: 'OI snapshots', description: 'Every snapshot the table holds.' },
  { id: ExportTable.AlgoTrades, label: 'Automated trades', description: 'Every automated trade.' },
];
const row = ({ table = tables[0], downloading = false, saved = null, error = null }: { table?: typeof tables[number]; downloading?: boolean; saved?: SavedFile | null; error?: string | null } = {}) =>
  renderToStaticMarkup(
    <TableExportPicker tables={tables} table={table} onSelect={() => {}} downloading={downloading} saved={saved} error={error} onDownload={() => {}} />,
  );
const downloadButton = (markup: string) => markup.match(/<button[^>]*admin-export__button[^>]*>.*?<\/button>/)?.[0] ?? '';
const openingTag = (markup: string) => downloadButton(markup).match(/<button[^>]*>/)?.[0] ?? '';

describe('TableExportPicker', () => {
  it('shows the picked table in the labelled list and only its description', () => {
    const markup = row({ table: tables[1] });
    expect(markup).toMatch(/<label[^>]*>.*Table.*Automated trades.*<\/label>/);
    expect(markup).toContain('Every automated trade.');
    expect(markup).not.toContain('Every snapshot the table holds.');
  });

  it('shows an enabled download button', () => {
    const markup = row();
    expect(markup).toContain('Excel .xlsx');
    expect(downloadButton(markup)).toContain('Download');
    expect(openingTag(markup)).not.toContain('disabled');
    expect(markup).not.toContain('Saved');
  });

  it('disables the button while the file is prepared', () => {
    const markup = row({ downloading: true });
    expect(downloadButton(markup)).toContain('Preparing…');
    expect(openingTag(markup)).toContain('disabled');
  });

  it('names the saved file and its size after a download', () => {
    expect(row({ saved: { fileName: 'oi-snapshots-2026-11-14.xlsx', size: 3 * 1024 * 1024 } }))
      .toContain('Saved oi-snapshots-2026-11-14.xlsx · 3.0 MB');
  });

  it("keeps the server's reason on the row when a download fails", () => {
    expect(row({ error: 'Too long for Excel' })).toContain('Too long for Excel');
  });
});

describe('fileSizeLabel', () => {
  it('keeps whole bytes under a kilobyte, then one decimal in the largest unit that fits', () => {
    expect(fileSizeLabel(0)).toBe('0 B');
    expect(fileSizeLabel(1023)).toBe('1023 B');
    expect(fileSizeLabel(1024)).toBe('1.0 KB');
    expect(fileSizeLabel(1536 * 1024)).toBe('1.5 MB');
    expect(fileSizeLabel(2 * 1024 ** 3)).toBe('2.0 GB');
  });
});
