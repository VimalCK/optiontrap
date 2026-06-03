/**
 * cacheDb — backward-compatible shim over the unified db.ts
 * All callers of cacheGet/cacheSet/cacheDelete continue to work unchanged.
 */
import { dbGet, dbSet, dbDelete, STORE_APP } from './db';

export async function cacheGet<T>(key: string): Promise<T | null> {
  return dbGet<T>(STORE_APP, key);
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  return dbSet(STORE_APP, key, value);
}

export async function cacheDelete(key: string): Promise<void> {
  return dbDelete(STORE_APP, key);
}
