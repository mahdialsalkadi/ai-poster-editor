import { describe, expect, it } from 'vitest';
import {
  applyDocumentLang,
  messages,
  readStoredLang,
  translate,
  UI_LANG_KEY,
  writeStoredLang,
  type Lang,
  type LangStorage,
  type MessageKey,
} from './i18n.js';

function storageWith(initial: Record<string, string> = {}): LangStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();

describe('i18n dictionaries', () => {
  it('keeps Arabic and English key sets identical', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ar).sort());
  });

  it('has no Arabic characters left in English chrome', () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(value, key).not.toMatch(/[\u0600-\u06ff]/);
    }
  });

  it('uses the same interpolation placeholders in both languages', () => {
    for (const key of Object.keys(messages.ar) as MessageKey[]) {
      expect(placeholders(messages.en[key]), key).toEqual(placeholders(messages.ar[key]));
    }
  });
});

describe('translate', () => {
  it('translates and fills named placeholders', () => {
    expect(translate('ar', 'toastImagesAdded', { count: 3 })).toBe('أُضيفت 3 صورة');
    expect(translate('en', 'multipleSelected', { count: 2 })).toBe('2 layers selected');
  });

  it('keeps unknown placeholders visible instead of printing undefined', () => {
    expect(translate('en', 'saveSavedAt', {})).toBe('Saved {time}');
  });
});

describe('language persistence', () => {
  it('defaults to Arabic when nothing valid is stored', () => {
    expect(readStoredLang(storageWith())).toBe('ar');
    expect(readStoredLang(storageWith({ [UI_LANG_KEY]: 'de' }))).toBe('ar');
  });

  it('reads and writes English', () => {
    const storage = storageWith();
    writeStoredLang('en', storage);
    expect(storage.values.get(UI_LANG_KEY)).toBe('en');
    expect(readStoredLang(storage)).toBe('en');
  });

  it('applies dir and lang to the document root', () => {
    const root: { dir: string; lang: string } = { dir: '', lang: '' };
    applyDocumentLang('en', root);
    expect(root).toEqual({ dir: 'ltr', lang: 'en' });
    applyDocumentLang('ar', root);
    expect(root).toEqual({ dir: 'rtl', lang: 'ar' });
  });

  it('round-trips every language', () => {
    for (const lang of ['ar', 'en'] as Lang[]) {
      const storage = storageWith();
      writeStoredLang(lang, storage);
      expect(readStoredLang(storage)).toBe(lang);
    }
  });
});
