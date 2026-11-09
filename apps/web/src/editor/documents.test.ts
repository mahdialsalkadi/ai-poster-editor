import { describe, expect, it } from 'vitest';
import { serializeDesignDoc } from '@poster/core';
import { createBlankDoc } from '../sample.js';
import { loadDocument, readStoredDocument, saveDocument } from './documents.js';

describe('document persistence boundary', () => {
  const record = {
    schemaVersion: 1,
    revision: 'revision-1',
    savedAt: 1,
    name: 'Poster',
    designHtml: serializeDesignDoc(createBlankDoc()),
  };
  it('validates saved HTML through the core parser', () => {
    expect(readStoredDocument(record).doc).toEqual(createBlankDoc());
    expect(() =>
      readStoredDocument({ ...record, designHtml: '<script>alert(1)</script>' }),
    ).toThrow();
  });
  it.each([
    null,
    {},
    { ...record, schemaVersion: 2 },
    { ...record, revision: '' },
    { ...record, savedAt: NaN },
  ])('rejects corrupt/unsupported records', (value) => {
    expect(() => readStoredDocument(value)).toThrow();
  });
  it('surfaces unavailable storage instead of claiming a successful save', async () => {
    await expect(loadDocument()).rejects.toThrow('IndexedDB');
    await expect(saveDocument(createBlankDoc(), 'Poster', null)).rejects.toThrow('IndexedDB');
  });
});
