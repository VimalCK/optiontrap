import React, { useEffect, useState } from 'react';
import { downloadTableExport, getTableExports, type TableExport } from '@/services/admin';
import { isAbortError } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import { saveFile } from '@/utils/saveFile';
import Message from '@/components/Message/Message';
import LoadingState from '@/components/LoadingState/LoadingState';
import EmptyState from '@/components/EmptyState/EmptyState';
import { CheckIcon, DownloadIcon, TableIcon } from '@/components/icons/Icons';
import { MessageTone } from '@/utils/uiEnums';
import type { ExportTableId } from '../../shared/appEnums.js';

const BYTES_PER_KB = 1024;
const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
const EXPORT_FACTS = ['Excel .xlsx', 'Every column', 'Every row'];

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** A file's size for display: 512 B, 3.4 KB, 12.0 MB. */
export const fileSizeLabel = (bytes: number) => {
  let size = bytes;
  let unit = 0;
  while (size >= BYTES_PER_KB && unit < FILE_SIZE_UNITS.length - 1) {
    size /= BYTES_PER_KB;
    unit += 1;
  }
  return unit === 0 ? `${size} B` : `${size.toFixed(1)} ${FILE_SIZE_UNITS[unit]}`;
};

export interface SavedFile {
  fileName: string;
  size: number;
}

/** One table: what it holds, its download button, and the last download's file or error. */
export const TableExportRow: React.FC<{
  table: TableExport;
  downloading: boolean;
  saved: SavedFile | null;
  error: string | null;
  onDownload: (id: ExportTableId) => void;
}> = ({ table, downloading, saved, error, onDownload }) => (
  <div className="hx-service admin-export__table">
    <span className="hx-service__icon"><TableIcon size={18} /></span>
    <div className="hx-service__body">
      <strong>{table.label}</strong>
      <small>{table.description}</small>
      <span className="admin-export__facts">
        {EXPORT_FACTS.map((fact) => <span key={fact} className="admin-export__fact">{fact}</span>)}
      </span>
      {saved && (
        <span className="admin-export__saved" role="status">
          <CheckIcon size={14} />Saved {saved.fileName} · {fileSizeLabel(saved.size)}
        </span>
      )}
      {error && <Message tone={MessageTone.Error} className="admin-export__message">{error}</Message>}
    </div>
    <button type="button" className="app-btn app-btn--primary admin-export__button" onClick={() => onDownload(table.id)} disabled={downloading}>
      <DownloadIcon size={16} />{downloading ? 'Preparing…' : 'Download'}
    </button>
  </div>
);

/** Admin → Data: download a table as an Excel file. */
const AdminData: React.FC = () => {
  const signal = useAbortSignal();
  const [tables, setTables] = useState<TableExport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<ExportTableId | null>(null);
  const [saved, setSaved] = useState<Partial<Record<ExportTableId, SavedFile>>>({});
  const [errors, setErrors] = useState<Partial<Record<ExportTableId, string>>>({});

  useEffect(() => {
    getTableExports(signal)
      .then(setTables)
      .catch((err) => { if (!isAbortError(err)) setLoadError(errorText(err, 'Failed to load the tables')); });
  }, [signal]);

  const download = async (id: ExportTableId) => {
    setDownloading(id);
    setSaved((prev) => ({ ...prev, [id]: undefined }));
    setErrors((prev) => ({ ...prev, [id]: undefined }));
    try {
      const { blob, fileName } = await downloadTableExport(id, signal);
      saveFile(blob, fileName);
      setSaved((prev) => ({ ...prev, [id]: { fileName, size: blob.size } }));
    } catch (err) {
      if (isAbortError(err)) return;
      setErrors((prev) => ({ ...prev, [id]: errorText(err, 'The download failed') }));
    } finally {
      if (!signal.aborted) setDownloading(null);
    }
  };

  if (loadError) return <Message tone={MessageTone.Error}>{loadError}</Message>;
  if (!tables) return <LoadingState label="Loading tables…" />;

  return (
    <section className="hx-panel admin-export" aria-labelledby="admin-export-title">
      <div className="hx-panel__title admin-export__title">
        <h2 id="admin-export-title">Download a table</h2>
        <p>Built on the server from the live table, a page at a time, so a large table can take a while.</p>
      </div>
      {tables.length === 0
        ? <EmptyState icon={<TableIcon size={64} />} title="No tables to download" />
        : tables.map((table) => (
          <TableExportRow
            key={table.id}
            table={table}
            downloading={downloading === table.id}
            saved={saved[table.id] ?? null}
            error={errors[table.id] ?? null}
            onDownload={download}
          />
        ))}
    </section>
  );
};

export default AdminData;
