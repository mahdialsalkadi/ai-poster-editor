import type { AssetEntry } from './assets.js';

/**
 * Uploaded images are kept in IndexedDB so a reload restores the asset library
 * and every `asset:<id>` layer still resolves. Only the original bytes are
 * stored; object URLs are created fresh on load.
 */
const DB_NAME = 'poster.assets';
const DB_VERSION = 1;
const STORE = 'assets';

type StoredAsset = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
  blob: Blob;
};

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function saveAssetRecord(entry: AssetEntry, blob: Blob): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE).put({
      id: entry.id,
      name: entry.name,
      mime: entry.mime,
      bytes: entry.bytes,
      width: entry.width,
      height: entry.height,
      createdAt: entry.createdAt,
      blob,
    } satisfies StoredAsset);
    await done;
  } catch {
    // Storage is a convenience; the session keeps working without it.
  } finally {
    db.close();
  }
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(id);
    await done;
  } catch {
    // Ignore a storage failure: removing the asset is already reflected in state.
  } finally {
    db.close();
  }
}

export async function loadAssetRecords(): Promise<AssetEntry[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, 'readonly');
    const done = transactionDone(tx);
    const records = await requestResult(
      tx.objectStore(STORE).getAll() as IDBRequest<StoredAsset[]>,
    );
    await done;
    return (records ?? [])
      .filter((record) => record.blob instanceof Blob)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((record) => ({
        id: record.id,
        name: record.name,
        url: URL.createObjectURL(record.blob),
        width: record.width,
        height: record.height,
        mime: record.mime,
        bytes: record.bytes,
        createdAt: record.createdAt,
      }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}
