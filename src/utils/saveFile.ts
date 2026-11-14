/** Hands a downloaded file to the browser to save under `fileName`. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked after this task, so the browser has started the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url));
}
