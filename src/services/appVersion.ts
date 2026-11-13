/**
 * The running build's version (short commit id, or 'local' in dev), from
 * GET /api/version. Shown on the Profile page.
 */
import { apiClient } from './apiClient';

export async function fetchAppVersion(signal?: AbortSignal): Promise<string> {
  const result = await apiClient.get<{ version: string }>('/api/version', { signal });
  return result.version;
}
