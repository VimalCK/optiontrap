import { describe, it, expect, vi, afterEach } from 'vitest';
import { attachmentFileName, downloadTableExport } from './admin';
import { ApiError } from './apiClient';
import { ExportTable } from '../../shared/appEnums.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attachmentFileName', () => {
  it('reads the name from a Content-Disposition header, quoted or not', () => {
    expect(attachmentFileName('attachment; filename="oi-snapshots-2026-11-14.xlsx"')).toBe('oi-snapshots-2026-11-14.xlsx');
    expect(attachmentFileName('attachment; filename=oi.xlsx')).toBe('oi.xlsx');
    expect(attachmentFileName(null)).toBeNull();
  });
});

describe('downloadTableExport', () => {
  it('asks for the table and returns the file with its name', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('xlsx bytes', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="oi-snapshots-2026-11-14.xlsx"' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { blob, fileName } = await downloadTableExport(ExportTable.OiSnapshots);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/table-exports/OiSnapshots');
    expect(fileName).toBe('oi-snapshots-2026-11-14.xlsx');
    expect(await blob.text()).toBe('xlsx bytes');
  });

  it("rejects with the server's reason when the export is refused", async () => {
    const message = "The 2026-11-13 13:20 IST snapshot's contracts is longer than Excel's 32,767 characters per cell, so it can't be exported whole.";
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })));

    const err = await downloadTableExport(ExportTable.OiSnapshots).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(message);
    expect((err as ApiError).status).toBe(400);
  });
});
