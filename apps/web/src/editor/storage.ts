import type { AssetEntry } from './assets.js';

/**
 * Uploaded images are kept in IndexedDB so a reload restores the asset library
 * and every `asset:<id>` layer still resolves. Only the original bytes are
 * stored; object URLs are created fresh on load.
 */
const DB_NAME = 'poster.assets';
const DB_VERSION = 3;
const STORE = 'assets';
const SNAPSHOT_STORE = 'snapshots';

export const MAX_SNAPSHOTS = 20;

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

export function openDatabase(): Promise<IDBDatabase | null> {
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
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
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

export type StoredSnapshot = {
  id: string;
  createdAt: number;
  instruction: string;
  designHtml: string;
};

export function createSnapshotId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `snap-${random}`;
}

function validSnapshot(value: unknown): value is StoredSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<StoredSnapshot>;
  return (
    typeof record.id === 'string' &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.instruction === 'string' &&
    typeof record.designHtml === 'string'
  );
}

/**
 * Keeps the pre-edit document in the browser, not on the server. The newest
 * entry is always the snapshot taken immediately before the most recent AI edit.
 */
export async function saveSnapshotRecord(record: StoredSnapshot): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const reading = db.transaction(SNAPSHOT_STORE, 'readonly');
    const readingDone = transactionDone(reading);
    const existing = await requestResult(
      reading.objectStore(SNAPSHOT_STORE).getAll() as IDBRequest<StoredSnapshot[]>,
    );
    await readingDone;
    const evict = (existing ?? [])
      .filter(validSnapshot)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(0, (existing?.length ?? 0) + 1 - MAX_SNAPSHOTS));

    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(SNAPSHOT_STORE);
    for (const entry of evict) store.delete(entry.id);
    store.put(record);
    await done;
  } catch {
    // Snapshotting is a convenience; a storage failure must not fail the edit.
  } finally {
    db.close();
  }
}

export async function loadSnapshotRecords(): Promise<StoredSnapshot[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const done = transactionDone(tx);
    const records = await requestResult(
      tx.objectStore(SNAPSHOT_STORE).getAll() as IDBRequest<StoredSnapshot[]>,
    );
    await done;
    return (records ?? [])
      .filter(validSnapshot)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_SNAPSHOTS);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function deleteSnapshotRecord(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(SNAPSHOT_STORE).delete(id);
    await done;
  } catch {
    // Ignore; the entry is no longer shown after a reload.
  } finally {
    db.close();
  }
}
