/**
 * Unified IndexedDB — single database "optiontrap" with all stores.
 *
 * Stores:
 *   app_data      — general key/value (positions, LTP cache, etc.)
 *   oi_snapshots  — intraday OI snapshots (keyPath: timestamp)
 *   nfo_data      — NFO instruments CSV cache
 *
 * Migration: on first open, copies existing data from the old
 * "optiontrap_cache" and "optiontrap_instruments" databases,
 * then deletes them so no data is lost.
 */

const DB_NAME = 'optiontrap';
const DB_VERSION = 1;

export const STORE_APP    = 'app_data';
export const STORE_OI     = 'oi_snapshots';
export const STORE_NFO    = 'nfo_data';

let dbPromise: Promise<IDBDatabase> | null = null;

// ── helpers ──────────────────────────────────────────────────────────────────

function openRaw(name: string, version: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name, version);
      req.onsuccess = () => resolve(req.result);
      req.onerror  = () => resolve(null);
      // If upgrade needed it means the DB doesn't exist yet in this browser — resolve null
      req.onupgradeneeded = () => {
        req.result.close();
        // Roll back the new DB creation by aborting
        req.transaction?.abort();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

function readAllKV(db: IDBDatabase, storeName: string): Promise<{ key: IDBValidKey; value: unknown }[]> {
  return new Promise((resolve) => {
    try {
      const tx  = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const items: { key: IDBValidKey; value: unknown }[] = [];
      const curReq = store.openCursor();
      curReq.onsuccess = () => {
        const cur = curReq.result;
        if (cur) { items.push({ key: cur.key, value: cur.value }); cur.continue(); }
        else resolve(items);
      };
      curReq.onerror = () => resolve(items);
    } catch {
      resolve([]);
    }
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror  = () => resolve(); // silently ignore
    req.onblocked = () => resolve();
  });
}

// ── migration ─────────────────────────────────────────────────────────────────

async function migrate(newDb: IDBDatabase): Promise<void> {
  // --- optiontrap_cache (version 2) → app_data + oi_snapshots ---
  const oldCache = await openRaw('optiontrap_cache', 2);
  if (oldCache) {
    console.log('[DB] Migrating optiontrap_cache...');

    // app_data store
    if (oldCache.objectStoreNames.contains('app_data')) {
      const items = await readAllKV(oldCache, 'app_data');
      if (items.length > 0) {
        await new Promise<void>((res) => {
          const tx = newDb.transaction(STORE_APP, 'readwrite');
          const store = tx.objectStore(STORE_APP);
          items.forEach(({ key, value }) => store.put(value, key));
          tx.oncomplete = () => { console.log(`[DB] Migrated ${items.length} app_data entries`); res(); };
          tx.onerror = () => res();
        });
      }
    }

    // oi_snapshots store
    if (oldCache.objectStoreNames.contains('oi_snapshots')) {
      const items = await readAllKV(oldCache, 'oi_snapshots');
      if (items.length > 0) {
        await new Promise<void>((res) => {
          const tx = newDb.transaction(STORE_OI, 'readwrite');
          const store = tx.objectStore(STORE_OI);
          items.forEach(({ value }) => store.put(value)); // keyPath: timestamp
          tx.oncomplete = () => { console.log(`[DB] Migrated ${items.length} oi_snapshots`); res(); };
          tx.onerror = () => res();
        });
      }
    }

    oldCache.close();
    await deleteDatabase('optiontrap_cache');
    console.log('[DB] optiontrap_cache deleted');
  }

  // --- optiontrap_instruments (version 1) → nfo_data ---
  const oldInstr = await openRaw('optiontrap_instruments', 1);
  if (oldInstr) {
    console.log('[DB] Migrating optiontrap_instruments...');

    if (oldInstr.objectStoreNames.contains('nfo_data')) {
      const items = await readAllKV(oldInstr, 'nfo_data');
      if (items.length > 0) {
        await new Promise<void>((res) => {
          const tx = newDb.transaction(STORE_NFO, 'readwrite');
          const store = tx.objectStore(STORE_NFO);
          items.forEach(({ key, value }) => store.put(value, key));
          tx.oncomplete = () => { console.log(`[DB] Migrated ${items.length} nfo_data entries`); res(); };
          tx.onerror = () => res();
        });
      }
    }

    oldInstr.close();
    await deleteDatabase('optiontrap_instruments');
    console.log('[DB] optiontrap_instruments deleted');
  }
}

// ── main open ─────────────────────────────────────────────────────────────────

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

    request.onsuccess = async () => {
      const db = request.result;
      // Run migration after DB is open (non-blocking for subsequent opens)
      try { await migrate(db); } catch (e) { console.warn('[DB] Migration error:', e); }
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// ── generic helpers ───────────────────────────────────────────────────────────

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
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
      const tx      = db.transaction(store, 'readonly');
      const results: T[] = [];
      const req = tx.objectStore(store).openCursor();
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
