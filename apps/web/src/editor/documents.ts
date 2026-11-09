import {
  parseDesignHtml,
  serializeDesignDoc,
  validateDesignDoc,
  type DesignDoc,
} from '@poster/core';
import { openDatabase } from './storage.js';

export const LEGACY_DOCUMENT_KEY = 'poster.design.v1';
export const LEGACY_NAME_KEY = 'poster.name.v1';

export type StoredDocument = {
  schemaVersion: 1;
  revision: string;
  savedAt: number;
  name: string;
  designHtml: string;
};

export type LoadedDocument = { record: StoredDocument; doc: DesignDoc };
export type DocumentLoad =
  | { kind: 'ready'; current: LoadedDocument | null; revision: string | null }
  | { kind: 'recovery'; backup: LoadedDocument | null; revision: string | null };

export class DocumentConflictError extends Error {
  constructor() {
    super('A different tab saved a newer document. Reload before saving.');
  }
}

export function readStoredDocument(value: unknown): LoadedDocument {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid saved document');
  const record = value as StoredDocument;
  if (
    record.schemaVersion !== 1 ||
    typeof record.revision !== 'string' ||
    !record.revision ||
    typeof record.name !== 'string' ||
    typeof record.savedAt !== 'number' ||
    !Number.isFinite(record.savedAt) ||
    typeof record.designHtml !== 'string'
  )
    throw new Error('Unsupported saved document');
  return { record, doc: parseDesignHtml(record.designHtml).doc };
}

function revisionOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const revision = (value as Partial<StoredDocument>).revision;
  return typeof revision === 'string' ? revision : null;
}

async function database(): Promise<IDBDatabase> {
  const db = await openDatabase();
  if (!db) throw new Error('IndexedDB is unavailable');
  return db;
}

export async function loadDocument(): Promise<DocumentLoad> {
  const db = await database();
  try {
    const [current, backup] = await new Promise<[unknown, unknown]>((resolve, reject) => {
      const tx = db.transaction('documents', 'readonly');
      const store = tx.objectStore('documents');
      const a = store.get('current');
      const b = store.get('backup');
      tx.oncomplete = () => resolve([a.result, b.result]);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not load document'));
    });
    const revision = revisionOf(current);
    if (current !== undefined) {
      try {
        return { kind: 'ready', current: readStoredDocument(current), revision };
      } catch {
        let recovered: LoadedDocument | null = null;
        try {
          recovered = readStoredDocument(backup);
        } catch {
          /* No usable backup. */
        }
        return { kind: 'recovery', backup: recovered, revision };
      }
    }
    // Remove legacy data only after the IndexedDB transaction commits. A failed
    // migration remains retryable, including quota and unavailable-storage errors.
    const raw = localStorage.getItem(LEGACY_DOCUMENT_KEY);
    if (raw !== null) {
      let doc: DesignDoc;
      try {
        doc = validateDesignDoc(JSON.parse(raw));
      } catch {
        return { kind: 'recovery', backup: null, revision: null };
      }
      const name = localStorage.getItem(LEGACY_NAME_KEY) ?? 'ملصق بدون عنوان';
      let record: StoredDocument;
      try {
        record = await saveDocument(doc, name, null);
      } catch (cause) {
        // Concurrent migration (including React StrictMode) already won.
        if (cause instanceof DocumentConflictError) return loadDocument();
        throw cause;
      }
      localStorage.removeItem(LEGACY_DOCUMENT_KEY);
      localStorage.removeItem(LEGACY_NAME_KEY);
      return { kind: 'ready', current: readStoredDocument(record), revision: record.revision };
    }
    return { kind: 'ready', current: null, revision: null };
  } finally {
    db.close();
  }
}

/** Read/compare/backup/write in one transaction: two tabs cannot both win. */
export async function saveDocument(
  doc: DesignDoc,
  name: string,
  expectedRevision: string | null,
): Promise<StoredDocument> {
  const designHtml = serializeDesignDoc(validateDesignDoc(doc));
  parseDesignHtml(designHtml);
  let record: StoredDocument = {
    schemaVersion: 1,
    revision: crypto.randomUUID(),
    savedAt: Date.now(),
    name,
    designHtml,
  };
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const request = store.get('current');
      let failure: Error | null = null;
      request.onsuccess = () => {
        if (revisionOf(request.result) !== expectedRevision) {
          failure = new DocumentConflictError();
          tx.abort();
          return;
        }
        try {
          if (request.result?.designHtml === designHtml && request.result?.name === name) {
            readStoredDocument(request.result);
            record = request.result as StoredDocument;
            return;
          }
          // Never rotate corrupt data over the last known-good backup.
          if (request.result !== undefined) {
            let valid = false;
            try {
              readStoredDocument(request.result);
              valid = true;
            } catch {
              /* Preserve the existing backup. */
            }
            if (valid) store.put(request.result, 'backup');
          }
          store.put(record, 'current');
        } catch (cause) {
          failure = cause instanceof Error ? cause : new Error('Could not save document');
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error('Could not save document'));
    });
    return record;
  } finally {
    db.close();
  }
}
