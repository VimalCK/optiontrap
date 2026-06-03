/**
 * Unified IndexedDB — single database "optiontrap".
 *
 * Stores:
 *   app_data      — general key/value (positions, LTP cache, etc.)
 *   oi_snapshots  — intraday OI snapshots (keyPath: timestamp)
 *   nfo_data      — NFO instruments CSV cache
 */

const DB_NAME = 'optiontrap';
const DB_VERSION = 1;

export const STORE_APP = 'app_data';
export const STORE_OI  = 'oi_snapshots';
export const STORE_NFO = 'nfo_data';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_APP)) {
        db.createObjectStore(STORE_APP);
      }
      if (!db.objectStoreNames.contains(STORE_OI)) {
        db.createObjectStore(STORE_OI, { keyPath: 'timestamp' });
      }
      if (!db.objectStoreNames.contains(STORE_NFO)) {
        db.createObjectStore(STORE_NFO);
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

export async function dbSet<T>(store: string, key: IDBValidKey, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch { /* silently fail */ }
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch { /* silently fail */ }
}

export async function dbGetAllCursor<T>(
  store: string,
  filter?: (item: T) => boolean,
): Promise<T[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const results: T[] = [];
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          const val = cur.value as T;
          if (!filter || filter(val)) results.push(val);
          cur.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => resolve(results);
    });
  } catch { return []; }
}

export async function dbPutNoKey<T>(store: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch { /* silently fail */ }
}

export async function dbDeleteCursor(
  store: string,
  shouldDelete: (value: unknown) => boolean,
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          if (shouldDelete(cur.value)) cur.delete();
          cur.continue();
        }
      };
      tx.oncomplete = () => resolve();
    });
  } catch { /* silently fail */ }
}
